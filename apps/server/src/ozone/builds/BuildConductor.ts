import {
  OZONE_VERIFICATION_ID,
  ozoneAppUrl,
  OzoneAppError,
  type OzoneBuild,
  type OzoneBuildCheckResult,
  type OzoneBuildPlanInput,
  type OzoneBuildReport,
  type OzoneBuildResolveInput,
  type OzoneBuildTask,
  type OzoneGateResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import type { McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import { PAGE_TEMPLATES } from "../apps/templates.ts";
import { failed as refuse } from "../errors.ts";
import { DESIGN_FILE, NEXT, planFile, specFile, workerBrief } from "./briefs.ts";
import * as BuildChecks from "./BuildChecks.ts";
import * as BuildDesign from "./BuildDesign.ts";
import * as BuildGates from "./BuildGates.ts";
import * as BuildModel from "./BuildModel.ts";
import * as BuildRepo from "./BuildRepo.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWorkers from "./BuildWorkers.ts";
import { readVerdicts, verifierBrief } from "./verification.ts";

/** The agent thread that owns a build, resolved by whoever received the call. */
export interface BuildLead {
  readonly scope: McpInvocationScope;
  readonly threadId: ThreadId;
  readonly app: ResolvedApp;
  /** The lead's turn runs in plan mode: the person reviews its plan in the thread, not here. */
  readonly planning: boolean;
  /** How long one `advance` may keep the lead's tool call open. */
  readonly patience: Duration.Duration;
}

/**
 * Runs a build: hands each ready task to a worker, has the result checked, sends failures back
 * for repair, and has a tester use the finished app. See docs/ozone/orchestrator.md.
 */
export class BuildConductor extends Context.Service<
  BuildConductor,
  {
    readonly get: (lead: BuildLead) => Effect.Effect<OzoneBuildReport, OzoneAppError>;
    readonly plan: (
      lead: BuildLead,
      input: OzoneBuildPlanInput,
    ) => Effect.Effect<OzoneBuildReport, OzoneAppError>;
    /** Safe to call again at any time: it first settles what happened, then takes the next step. */
    readonly advance: (lead: BuildLead) => Effect.Effect<OzoneBuildReport, OzoneAppError>;
    readonly resolve: (
      lead: BuildLead,
      input: OzoneBuildResolveInput,
    ) => Effect.Effect<OzoneBuildReport, OzoneAppError>;
    /** Runs the task checks on the tree as it is, without committing. */
    readonly check: (lead: BuildLead) => Effect.Effect<OzoneBuildCheckResult, OzoneAppError>;
  }
>()("t3/ozone/builds/BuildConductor") {}

const MIRROR_DIRECTORY = ".ozone";
const NOTE_CHARS = 1_200;
const SUMMARY_CHARS = 400;

const isSettled = (task: OzoneBuildTask) => task.status === "done" || task.status === "skipped";
const isActive = (task: OzoneBuildTask) => task.status === "running" || task.status === "checking";
const failures = (gates: ReadonlyArray<OzoneGateResult>) => gates.filter((gate) => !gate.ok);

const noteFor = (task: OzoneBuildTask): string | undefined => {
  if (task.status === "blocked") {
    const failed = failures(task.evidence)
      .map((gate) => `${gate.id}: ${gate.detail.slice(-NOTE_CHARS)}`)
      .join("\n");
    return [task.blockedReason, failed].filter(Boolean).join("\n") || undefined;
  }
  if (task.status === "pending" && task.attempts > 0) {
    const failed = failures(task.evidence).map((gate) => gate.id);
    return failed.length === 0
      ? "Going back to a new worker."
      : `Going back for repair: it did not pass ${failed.join(", ")}.`;
  }
  if (task.status !== "done") return undefined;
  // Says outright that the work is in history, so the lead need not go and look.
  const committed = task.commitSha === null ? "Kept." : `Committed ${task.commitSha.slice(0, 7)}.`;
  return task.summary === null ? committed : `${committed} ${task.summary.slice(0, SUMMARY_CHARS)}`;
};

/** The step a build is waiting for, when the lead did not just take one. */
const nextFor = (lead: BuildLead, build: OzoneBuild): string => {
  const status = BuildModel.statusOf(build);
  if (status === "planning") return NEXT.plan;
  if (status === "review") return NEXT.review;
  if (status === "complete") return NEXT.complete(ozoneAppUrl(lead.app.app), build.verification);
  const blockedTask = build.tasks.find((task) => task.status === "blocked");
  if (blockedTask !== undefined) return NEXT.blocked(blockedTask);
  if (status === "blocked") {
    const failed = failures(build.finalEvidence);
    return failed.length > 0
      ? NEXT.finalFailed(failed)
      : NEXT.verifyFailed(build.verification.results);
  }
  const checkingTask = build.tasks.find((task) => task.status === "checking");
  if (checkingTask !== undefined) return NEXT.checking(checkingTask);
  const workingTask = build.tasks.find((task) => task.status === "running");
  if (workingTask !== undefined) return NEXT.working(workingTask);
  if (build.finalStartedAt !== null) return NEXT.finalChecking;
  return build.verification.status === "running" ? NEXT.verifying : NEXT.advance;
};

/** What the lead is told, with a `next` it can follow without re-deriving the build's state. */
const report = (lead: BuildLead, build: OzoneBuild, next?: string): OzoneBuildReport => ({
  status: BuildModel.statusOf(build),
  tasks: build.tasks.map((task) => {
    const note = noteFor(task);
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      attempts: task.attempts,
      ...(note === undefined ? {} : { note }),
      ...(isActive(task) && task.workerThreadId !== null
        ? { workerThreadId: task.workerThreadId }
        : {}),
    };
  }),
  next: next ?? nextFor(lead, build),
});

const make = Effect.gen(function* () {
  const store = yield* BuildStore.BuildStore;
  const design = yield* BuildDesign.BuildDesign;
  const workers = yield* BuildWorkers.BuildWorkers;
  const checks = yield* BuildChecks.BuildChecks;
  const gates = yield* BuildGates.BuildGates;
  const repo = yield* BuildRepo.BuildRepo;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // One step at a time per build: two calls must never hand the same task to two workers.
  const locks = new Map<ThreadId, Semaphore.Semaphore>();
  const exclusively = <A, E>(threadId: ThreadId, effect: Effect.Effect<A, E>) => {
    const lock = locks.get(threadId) ?? Semaphore.makeUnsafe(1);
    locks.set(threadId, lock);
    return lock.withPermits(1)(effect);
  };

  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const started = (lead: BuildLead, current: OzoneBuild | null, at: string) =>
    current ?? BuildModel.emptyBuild(lead.threadId, lead.app.app.projectId, at);
  const load = Effect.fn("BuildConductor.load")(function* (lead: BuildLead) {
    return started(lead, yield* store.get(lead.threadId), yield* now);
  });
  /** Changes the build as it is stored now: a check job may have saved since this step read it. */
  const change = Effect.fn("BuildConductor.change")(function* (
    lead: BuildLead,
    step: (build: OzoneBuild, at: string) => OzoneBuild,
  ) {
    const at = yield* now;
    return yield* store.modify(lead.threadId, (current) => {
      const next = step(started(lead, current, at), at);
      return [next, next];
    });
  });
  /** The same for a change the rules may refuse. A refused change saves nothing. */
  const decide = Effect.fn("BuildConductor.decide")(function* (
    lead: BuildLead,
    step: (build: OzoneBuild, at: string) => BuildModel.Decision,
  ) {
    const at = yield* now;
    const decision = yield* store.modify(lead.threadId, (current) => {
      const decided = step(started(lead, current, at), at);
      return [decided, decided.ok ? decided.build : null];
    });
    return decision.ok ? decision.build : yield* refuse(decision.problems.join(" "));
  });
  const taskChecks = (app: ResolvedApp) =>
    app.manifest.gates.filter((gate) => gate.when === "task").map((gate) => gate.id);

  /** Brings one task up to date with its worker, and says what it now waits for. */
  const settle = Effect.fn("BuildConductor.settle")(function* (
    lead: BuildLead,
    task: OzoneBuildTask,
  ) {
    if (task.status === "checking") return "checking" as const;
    if (task.workerTaskId === null) {
      yield* change(lead, (build, at) =>
        BuildModel.failed(
          build,
          task.id,
          { evidence: [], summary: null, reason: "Its worker was never started." },
          at,
        ),
      );
      return "settled" as const;
    }
    const status = yield* workers.status(lead.scope, task.workerTaskId);
    if (status.state === "working") return "working" as const;
    if (status.state === "waiting_for_answer") return "needs_answer" as const;
    if (status.state === "completed") {
      // Saved before the checks start, so a restart knows the worker had finished.
      yield* change(lead, (build, at) => BuildModel.checking(build, task.id, status.summary, at));
      return "checking" as const;
    }
    yield* change(lead, (build, at) =>
      BuildModel.failed(
        build,
        task.id,
        {
          evidence: [],
          summary: status.summary,
          reason: `Its worker ended as ${status.ending ?? "failed"}.`,
        },
        at,
      ),
    );
    return "settled" as const;
  });

  const dispatch = Effect.fn("BuildConductor.dispatch")(function* (
    lead: BuildLead,
    build: OzoneBuild,
    task: OzoneBuildTask,
  ) {
    const baseSha = yield* repo.head(lead.app.workspaceRoot);
    const handle = yield* workers.dispatch(lead.scope, {
      key: `ozone:${lead.threadId}:${task.id}:${task.dispatches + 1}`,
      title: task.title,
      brief: workerBrief(build, task, taskChecks(lead.app)),
      access: task.access,
      model: lead.app.app.settings.workerModel,
    });
    yield* change(lead, (current, at) =>
      BuildModel.started(current, task.id, { ...handle, baseSha }, at),
    );
  });

  const dispatchTester = Effect.fn("BuildConductor.dispatchTester")(function* (
    lead: BuildLead,
    build: OzoneBuild,
  ) {
    const handle = yield* workers.dispatch(lead.scope, {
      key: `ozone:${lead.threadId}:${OZONE_VERIFICATION_ID}:${build.verification.dispatches + 1}`,
      title: "Try the app",
      brief: verifierBrief(build.acceptance, lead.app.app.port),
      access: "read",
      model: lead.app.app.settings.workerModel,
    });
    yield* change(lead, (current, at) => BuildModel.verificationStarted(current, handle, at));
  });

  /** Brings the build up to date with its tester, and says what it now waits for. */
  const settleTester = Effect.fn("BuildConductor.settleTester")(function* (
    lead: BuildLead,
    build: OzoneBuild,
  ) {
    const { workerTaskId } = build.verification;
    const status =
      workerTaskId === null
        ? { state: "failed" as const, summary: null, ending: "never started" }
        : yield* workers.status(lead.scope, workerTaskId);
    if (status.state === "working") return "working" as const;
    if (status.state === "waiting_for_answer") return "needs_answer" as const;
    const results = readVerdicts(
      build.acceptance,
      status.state === "completed" ? (status.summary ?? "") : "",
    );
    const note =
      status.state === "completed" ? null : `the tester ended as ${status.ending ?? "failed"}`;
    yield* change(lead, (current, at) => BuildModel.verified(current, results, note, at));
    return "settled" as const;
  });

  /** Done tasks whose commits a rollback or reset removed go back into the plan. */
  const reopenLost = Effect.fn("BuildConductor.reopenLost")(function* (
    lead: BuildLead,
    build: OzoneBuild,
  ) {
    const root = lead.app.workspaceRoot;
    if ((yield* repo.head(root)) === null) return;
    const lost: Array<string> = [];
    for (const task of build.tasks) {
      if (task.status !== "done" || task.commitSha === null) continue;
      if (!(yield* repo.isInHistory(root, task.commitSha))) lost.push(task.id);
    }
    if (lost.length > 0)
      yield* change(lead, (current, at) => BuildModel.reopened(current, lost, at));
  });

  const advance = Effect.fn("BuildConductor.advance")(function* (lead: BuildLead) {
    const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(lead.patience);
    const patienceLeft = Effect.map(Clock.currentTimeMillis, (at) =>
      Duration.millis(Math.max(0, deadline - at)),
    );
    const target = { threadId: lead.threadId, app: lead.app };
    const told = Effect.fn("BuildConductor.told")(function* (next?: string) {
      return report(lead, yield* load(lead), next);
    });

    const planned = yield* load(lead);
    if (planned.tasks.length === 0) return report(lead, planned);
    // Only BuildReview.approve, which a person starts, lets a waiting plan run.
    if (planned.approval === "pending") return report(lead, planned);
    yield* reopenLost(lead, planned);

    let finalRan = false;
    for (;;) {
      const build = yield* load(lead);

      const inFlight = build.tasks.filter(isActive);
      let asking: OzoneBuildTask | undefined;
      let checking: OzoneBuildTask | undefined;
      let working: OzoneBuildTask | undefined;
      for (const task of inFlight) {
        const state = yield* settle(lead, task);
        if (state === "needs_answer") asking ??= task;
        else if (state === "checking") checking ??= task;
        else if (state === "working") working ??= task;
      }
      if (asking !== undefined) {
        return yield* told(
          NEXT.needsAnswer(`The worker on task ${asking.id}`, asking.workerThreadId),
        );
      }
      if (checking !== undefined) {
        if (yield* checks.run(target, { task: checking.id }, yield* patienceLeft)) continue;
        return yield* told(NEXT.checking(checking));
      }
      if (working !== undefined) {
        const left = yield* patienceLeft;
        if (Duration.isZero(left) || working.workerThreadId === null) return yield* told();
        yield* workers.wait(lead.scope, working.workerThreadId, left);
        continue;
      }
      // What was in flight has settled. Look again at what that leaves to do.
      if (inFlight.length > 0) continue;

      if (build.verification.status === "running") {
        const tester = yield* settleTester(lead, build);
        if (tester === "settled") continue;
        const { workerThreadId } = build.verification;
        if (tester === "needs_answer") {
          return yield* told(NEXT.needsAnswer("The tester", workerThreadId));
        }
        const left = yield* patienceLeft;
        if (Duration.isZero(left) || workerThreadId === null) return report(lead, build);
        yield* workers.wait(lead.scope, workerThreadId, left);
        continue;
      }

      // The lead's harness may have put a long call in the background and ended the lead's
      // turn, and upstream starts a worker only for a lead whose turn is running.
      const mayStartWorkers = !Duration.isZero(yield* patienceLeft);

      if (!build.tasks.every(isSettled)) {
        const ready = mayStartWorkers ? BuildModel.nextTasks(build) : [];
        if (ready.length > 0) {
          for (const task of ready) yield* dispatch(lead, build, task);
          continue;
        }
        const waitsOnPlan =
          mayStartWorkers && !build.tasks.some((task) => task.status === "blocked");
        return report(lead, build, waitsOnPlan ? NEXT.waitingOnPlan : undefined);
      }
      if (BuildModel.awaitsFinalCheck(build)) {
        // A final check that failed in this step is the lead's to fix, not to run again.
        if (finalRan) return report(lead, build);
        finalRan = true;
        // No worker is needed for it, so it starts even in a step that has used its patience.
        if (yield* checks.run(target, "final", yield* patienceLeft)) continue;
        return yield* told(NEXT.finalChecking);
      }
      if (build.verification.status === "pending" && mayStartWorkers) {
        yield* dispatchTester(lead, build);
        continue;
      }
      return report(lead, build);
    }
  });

  const hasDesign = (lead: BuildLead) =>
    fs
      .exists(path.join(lead.app.workspaceRoot, DESIGN_FILE))
      .pipe(Effect.orElseSucceed(() => false));

  const writeMirror = Effect.fn("BuildConductor.writeMirror")(function* (
    lead: BuildLead,
    build: OzoneBuild,
  ) {
    const directory = path.join(lead.app.workspaceRoot, MIRROR_DIRECTORY);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(path.join(directory, "spec.md"), specFile(build));
    yield* fs.writeFileString(path.join(directory, "plan.md"), planFile(build));
  });

  const resolve = Effect.fn("BuildConductor.resolve")(function* (
    lead: BuildLead,
    input: OzoneBuildResolveInput,
  ) {
    if (input.taskId === OZONE_VERIFICATION_ID) {
      const ruled = yield* decide(lead, (build, at) =>
        BuildModel.verificationRuled(build, input.ruling, input.note, at),
      );
      return report(lead, ruled);
    }
    if (input.ruling === "accept") {
      yield* checks.accept({ threadId: lead.threadId, app: lead.app }, input.taskId);
      return report(lead, yield* load(lead), NEXT.advance);
    }
    const { ruling, note } = input;
    const ruled = yield* decide(lead, (build, at) => {
      const decision = BuildModel.resolved(build, input.taskId, ruling, at);
      if (!decision.ok || ruling !== "retry" || note === undefined) return decision;
      // The lead's guidance travels with the evidence into the next worker's brief.
      return { ...decision, build: BuildModel.guided(decision.build, input.taskId, note) };
    });
    return report(lead, ruled, NEXT.advance);
  });

  return BuildConductor.of({
    get: Effect.fn("BuildConductor.get")(function* (lead) {
      return report(lead, yield* load(lead));
    }),
    plan: Effect.fn("BuildConductor.plan")((lead, input) =>
      exclusively(
        lead.threadId,
        Effect.gen(function* () {
          const { reviewPlans, chooseDesign } = lead.app.app.settings;
          // The person picks the look first; DESIGN.md is their pick, and later plans follow it.
          // An API has no pages, so it has no design to pick even if the setting was turned on.
          const pages = PAGE_TEMPLATES.has(lead.app.app.templateId);
          if (chooseDesign && pages && !(yield* hasDesign(lead))) {
            const shown = (yield* design.pending(lead.threadId)) !== null;
            return report(lead, yield* load(lead), shown ? NEXT.designWaiting : NEXT.chooseDesign);
          }
          if (lead.planning) return report(lead, yield* load(lead), NEXT.planning);
          const build = yield* decide(lead, (current, at) =>
            BuildModel.applyPlan(current, input, at, { reviewPlans }),
          );
          // Briefs point at these files; a build still works without them.
          yield* writeMirror(lead, build).pipe(Effect.ignore);
          return report(lead, build, build.approval === "pending" ? NEXT.review : NEXT.planned);
        }),
      ),
    ),
    advance: Effect.fn("BuildConductor.advance")((lead) =>
      exclusively(lead.threadId, advance(lead)),
    ),
    resolve: Effect.fn("BuildConductor.resolve")((lead, input) =>
      exclusively(lead.threadId, resolve(lead, input)),
    ),
    check: Effect.fn("BuildConductor.check")(function* (lead) {
      const outcome = yield* gates.task(lead.app, {
        baseSha: yield* repo.head(lead.app.workspaceRoot),
      });
      const failed = failures(outcome.results);
      if (outcome.needsDecision !== null) {
        return {
          gates: outcome.results,
          next: `${outcome.needsDecision}\nAsk the user before keeping this migration.`,
        };
      }
      if (failed.length > 0) {
        return {
          gates: outcome.results,
          next: `Fix what failed (${failed.map((gate) => gate.id).join(", ")}), then call ozone_build_check again.`,
        };
      }
      // A build stopped by its final check is not fine until that check passes too.
      const build = yield* load(lead);
      if (failures(build.finalEvidence).length === 0) {
        return { gates: outcome.results, next: NEXT.checksPass };
      }
      const final = yield* gates.final(lead.app);
      const finalFailed = failures(final);
      return {
        gates: [...outcome.results, ...final],
        next: finalFailed.length > 0 ? NEXT.finalFailed(finalFailed) : NEXT.finalPasses,
      };
    }),
  });
});

export const layer = Layer.effect(BuildConductor, make);
