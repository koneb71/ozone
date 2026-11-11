import {
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
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import type { McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import * as AppData from "../data/AppData.ts";
import { NEXT, planFile, specFile, workerBrief } from "./briefs.ts";
import * as BuildGates from "./BuildGates.ts";
import * as BuildModel from "./BuildModel.ts";
import * as BuildRepo from "./BuildRepo.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWorkers from "./BuildWorkers.ts";

/** The agent thread that owns a build, resolved by whoever received the call. */
export interface BuildLead {
  readonly scope: McpInvocationScope;
  readonly threadId: ThreadId;
  readonly app: ResolvedApp;
  /** How long one `advance` may keep the lead's tool call open. */
  readonly patience: Duration.Duration;
}

/**
 * Runs a build: hands each ready task to a worker, checks the result itself, sends failures back
 * for repair, and commits and snapshots what passes. See docs/ozone/orchestrator.md.
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
const refuse = (message: string) => new OzoneAppError({ reason: "failed", message });

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

/** What the lead is told, with a `next` it can follow without re-deriving the build's state. */
const report = (lead: BuildLead, build: OzoneBuild, next?: string): OzoneBuildReport => {
  const status = BuildModel.statusOf(build);
  const blockedTask = build.tasks.find((task) => task.status === "blocked");
  const workingTask = build.tasks.find(isActive);
  const defaultNext =
    status === "planning"
      ? NEXT.plan
      : status === "complete"
        ? NEXT.complete(ozoneAppUrl(lead.app.app))
        : blockedTask !== undefined
          ? NEXT.blocked(blockedTask)
          : status === "blocked"
            ? NEXT.finalFailed(failures(build.finalEvidence).map((gate) => gate.id))
            : workingTask !== undefined
              ? NEXT.working(workingTask)
              : NEXT.advance;
  return {
    status,
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
    next: next ?? defaultNext,
  };
};

const make = Effect.gen(function* () {
  const store = yield* BuildStore.BuildStore;
  const workers = yield* BuildWorkers.BuildWorkers;
  const gates = yield* BuildGates.BuildGates;
  const repo = yield* BuildRepo.BuildRepo;
  const data = yield* AppData.AppData;
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
  const save = (build: OzoneBuild) => Effect.as(store.put(build), build);
  const load = Effect.fn("BuildConductor.load")(function* (lead: BuildLead) {
    const stored = yield* store.get(lead.threadId);
    return stored ?? BuildModel.emptyBuild(lead.threadId, lead.app.app.projectId, yield* now);
  });
  const taskChecks = (app: ResolvedApp) =>
    app.manifest.gates.filter((gate) => gate.when === "task").map((gate) => gate.id);

  /** Commits the tree for a task and snapshots the data beside it. */
  const keep = Effect.fn("BuildConductor.keep")(function* (
    lead: BuildLead,
    build: OzoneBuild,
    task: OzoneBuildTask,
    evidence: ReadonlyArray<OzoneGateResult>,
    summary: string | null,
  ) {
    const commitSha = yield* repo.commitAll(
      lead.app.workspaceRoot,
      `${task.title}\n\nOzone build task ${task.id}.`,
    );
    // A missing snapshot must not undo work that passed; the next task takes another.
    const snapshot = yield* data
      .snapshot({ projectId: lead.app.app.projectId, reason: "task", label: task.title })
      .pipe(Effect.option);
    return yield* save(
      BuildModel.passed(
        build,
        task.id,
        { commitSha, snapshotId: Option.getOrNull(snapshot)?.id ?? null, evidence, summary },
        yield* now,
      ),
    );
  });

  /** Judges a finished task with the server's own checks. */
  const judge = Effect.fn("BuildConductor.judge")(function* (
    lead: BuildLead,
    current: OzoneBuild,
    task: OzoneBuildTask,
    summary: string | null,
  ) {
    const root = lead.app.workspaceRoot;
    const build = yield* save(BuildModel.checking(current, task.id, summary, yield* now));
    if (task.access === "read") {
      if (!(yield* repo.hasChanges(root))) {
        return yield* save(
          BuildModel.passed(
            build,
            task.id,
            { commitSha: yield* repo.head(root), snapshotId: null, evidence: [], summary },
            yield* now,
          ),
        );
      }
      // Kept, but out of the tree the next writer starts from.
      yield* repo.setAside(root, `ozone: changes made by read-only task ${task.id}`);
      return yield* save(
        BuildModel.failed(
          build,
          task.id,
          {
            evidence: [
              {
                id: "read-only",
                ok: false,
                detail: "The task changed files. They were set aside with git stash.",
              },
            ],
            summary,
            reason: "It changed files though it was read-only.",
          },
          yield* now,
        ),
      );
    }
    const outcome = yield* gates.task(lead.app, { baseSha: task.baseSha });
    if (outcome.needsDecision !== null) {
      return yield* save(
        BuildModel.blocked(
          build,
          task.id,
          { evidence: outcome.results, summary, reason: outcome.needsDecision },
          yield* now,
        ),
      );
    }
    const failed = failures(outcome.results);
    if (failed.length === 0) return yield* keep(lead, build, task, outcome.results, summary);
    return yield* save(
      BuildModel.failed(
        build,
        task.id,
        {
          evidence: outcome.results,
          summary,
          reason: `It did not pass ${failed.map((gate) => gate.id).join(", ")}.`,
        },
        yield* now,
      ),
    );
  });

  /** Brings one running task up to date with what its worker has done. */
  const settle = Effect.fn("BuildConductor.settle")(function* (
    lead: BuildLead,
    build: OzoneBuild,
    task: OzoneBuildTask,
  ) {
    // A step that stopped during the checks runs them again: the worker had finished.
    if (task.status === "checking") {
      return { build: yield* judge(lead, build, task, task.summary), state: "settled" as const };
    }
    if (task.workerTaskId === null) {
      const lost = BuildModel.failed(
        build,
        task.id,
        { evidence: [], summary: null, reason: "Its worker was never started." },
        yield* now,
      );
      return { build: yield* save(lost), state: "settled" as const };
    }
    const status = yield* workers.status(lead.scope, task.workerTaskId);
    if (status.state === "working") return { build, state: "working" as const };
    if (status.state === "waiting_for_answer") return { build, state: "needs_answer" as const };
    if (status.state === "completed") {
      return { build: yield* judge(lead, build, task, status.summary), state: "settled" as const };
    }
    const ended = BuildModel.failed(
      build,
      task.id,
      {
        evidence: [],
        summary: status.summary,
        reason: `Its worker ended as ${status.ending ?? "failed"}.`,
      },
      yield* now,
    );
    return { build: yield* save(ended), state: "settled" as const };
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
    });
    return yield* save(BuildModel.started(build, task.id, { ...handle, baseSha }, yield* now));
  });

  /** Done tasks whose commits a rollback or reset removed go back into the plan. */
  const reopenLost = Effect.fn("BuildConductor.reopenLost")(function* (
    lead: BuildLead,
    build: OzoneBuild,
  ) {
    const root = lead.app.workspaceRoot;
    if ((yield* repo.head(root)) === null) return build;
    const lost: Array<string> = [];
    for (const task of build.tasks) {
      if (task.status !== "done" || task.commitSha === null) continue;
      if (!(yield* repo.isInHistory(root, task.commitSha))) lost.push(task.id);
    }
    return lost.length === 0 ? build : yield* save(BuildModel.reopened(build, lost, yield* now));
  });

  const advance = Effect.fn("BuildConductor.advance")(function* (lead: BuildLead) {
    const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(lead.patience);
    let build = yield* load(lead);
    if (build.tasks.length === 0) return report(lead, build);
    build = yield* reopenLost(lead, build);

    for (;;) {
      let working: OzoneBuildTask | undefined;
      for (const task of build.tasks.filter(isActive)) {
        const settled = yield* settle(lead, build, task);
        build = settled.build;
        if (settled.state === "needs_answer") return report(lead, build, NEXT.needsAnswer(task));
        if (settled.state === "working") working ??= task;
      }
      if (working !== undefined) {
        const remaining = deadline - (yield* Clock.currentTimeMillis);
        if (remaining <= 0 || working.workerThreadId === null) return report(lead, build);
        yield* workers.wait(lead.scope, working.workerThreadId, Duration.millis(remaining));
        continue;
      }

      const ready = BuildModel.nextTasks(build);
      if (ready.length > 0) {
        for (const task of ready) build = yield* dispatch(lead, build, task);
        continue;
      }
      if (!build.tasks.every(isSettled)) {
        const stuck = build.tasks.some((task) => task.status === "blocked");
        return report(lead, build, stuck ? undefined : NEXT.waitingOnPlan);
      }
      if (build.completedAt === null) {
        build = yield* save(BuildModel.finished(build, yield* gates.final(lead.app), yield* now));
      }
      return report(lead, build);
    }
  });

  const writeMirror = Effect.fn("BuildConductor.writeMirror")(function* (
    lead: BuildLead,
    build: OzoneBuild,
  ) {
    const directory = path.join(lead.app.workspaceRoot, MIRROR_DIRECTORY);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(path.join(directory, "spec.md"), specFile(build));
    yield* fs.writeFileString(path.join(directory, "plan.md"), planFile(build));
  });

  return BuildConductor.of({
    get: Effect.fn("BuildConductor.get")(function* (lead) {
      return report(lead, yield* load(lead));
    }),
    plan: Effect.fn("BuildConductor.plan")((lead, input) =>
      exclusively(
        lead.threadId,
        Effect.gen(function* () {
          const decision = BuildModel.applyPlan(yield* load(lead), input, yield* now);
          if (!decision.ok) return yield* refuse(decision.problems.join(" "));
          // Briefs point at these files; a build still works without them.
          yield* writeMirror(lead, decision.build).pipe(Effect.ignore);
          return report(lead, yield* save(decision.build), NEXT.planned);
        }),
      ),
    ),
    advance: Effect.fn("BuildConductor.advance")((lead) =>
      exclusively(lead.threadId, advance(lead)),
    ),
    resolve: Effect.fn("BuildConductor.resolve")((lead, input) =>
      exclusively(
        lead.threadId,
        Effect.gen(function* () {
          const build = yield* load(lead);
          if (input.ruling !== "accept") {
            const decision = BuildModel.resolved(build, input.taskId, input.ruling, yield* now);
            if (!decision.ok) return yield* refuse(decision.problems.join(" "));
            // The lead's guidance travels with the evidence into the next worker's brief.
            const guided =
              input.ruling === "retry" && input.note !== undefined
                ? {
                    ...decision.build,
                    tasks: decision.build.tasks.map((task) =>
                      task.id === input.taskId
                        ? {
                            ...task,
                            evidence: [
                              ...task.evidence,
                              { id: "lead", ok: false, detail: input.note ?? "" },
                            ],
                          }
                        : task,
                    ),
                  }
                : decision.build;
            return report(lead, yield* save(guided), NEXT.advance);
          }
          const task = build.tasks.find((candidate) => candidate.id === input.taskId);
          if (task === undefined) return yield* refuse(`There is no task called ${input.taskId}.`);
          if (task.status !== "blocked") {
            return yield* refuse(
              `Task ${task.id} is ${task.status}, not blocked. Only a blocked task needs a ruling.`,
            );
          }
          const kept = yield* keep(lead, build, task, task.evidence, task.summary);
          return report(lead, kept, NEXT.advance);
        }),
      ),
    ),
    check: Effect.fn("BuildConductor.check")(function* (lead) {
      const outcome = yield* gates.task(lead.app, {
        baseSha: yield* repo.head(lead.app.workspaceRoot),
      });
      const failed = failures(outcome.results);
      return {
        gates: outcome.results,
        next:
          outcome.needsDecision !== null
            ? `${outcome.needsDecision}\nAsk the user before keeping this migration.`
            : failed.length === 0
              ? "Every check passes."
              : `Fix what failed (${failed.map((gate) => gate.id).join(", ")}), then call ozone_build_check again.`,
      };
    }),
  });
});

export const layer = Layer.effect(BuildConductor, make);
