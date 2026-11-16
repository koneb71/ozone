import {
  OzoneAppError,
  type OzoneBuild,
  type OzoneBuildTask,
  type OzoneGateResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppData from "../data/AppData.ts";
import { parseHeldBack } from "../data/migrationGuard.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { failed as refuse } from "../errors.ts";
import { WAKE } from "./briefs.ts";
import * as BuildGates from "./BuildGates.ts";
import * as BuildModel from "./BuildModel.ts";
import * as BuildRepo from "./BuildRepo.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWake from "./BuildWake.ts";

/** The build a check belongs to, and the app it runs in. */
export interface CheckTarget {
  readonly threadId: ThreadId;
  readonly app: AppRegistry.ResolvedApp;
}

/** One finished task, or the check that runs once when every task has passed. */
export type Check = { readonly task: string } | "final";

/**
 * Judges finished work in jobs of the server's own. A type check, a test suite or a production
 * build can outlast the tool call that asked for it, and the lead's turn with it: the job goes
 * on, saves what it found, and wakes the lead if nobody is waiting any more.
 */
export class BuildChecks extends Context.Service<
  BuildChecks,
  {
    /**
     * Makes sure the check is running and waits for it up to `patience`. False means it is still
     * running: the caller leaves, and the lead is woken when it ends.
     */
    readonly run: (
      target: CheckTarget,
      check: Check,
      patience: Duration.Duration,
    ) => Effect.Effect<boolean, OzoneAppError>;
    /** Keeps a blocked task's work as it is, with a commit and a snapshot: the `accept` ruling. */
    readonly accept: (target: CheckTarget, taskId: string) => Effect.Effect<void, OzoneAppError>;
  }
>()("t3/ozone/builds/BuildChecks") {}

interface Job {
  /** What to tell a lead nobody is holding a call open for, or null when there is no news. */
  readonly result: Deferred.Deferred<BuildWake.WakeNote | null, OzoneAppError>;
  /** A tool call is waiting for the result and will tell the lead itself. */
  watched: boolean;
  done: boolean;
}

const failures = (gates: ReadonlyArray<OzoneGateResult>) => gates.filter((gate) => !gate.ok);
const isAppError = Schema.is(OzoneAppError);
const keyOf = (threadId: ThreadId, check: Check) =>
  check === "final" ? `${threadId}:final` : `${threadId}:task:${check.task}`;

const make = Effect.gen(function* () {
  const store = yield* BuildStore.BuildStore;
  const gates = yield* BuildGates.BuildGates;
  const repo = yield* BuildRepo.BuildRepo;
  const data = yield* AppData.AppData;
  const runtime = yield* AppRuntime.AppRuntime;
  const registry = yield* AppRegistry.AppRegistry;
  const wake = yield* BuildWake.BuildWake;
  // Jobs live as long as the server, not as long as the call that started them.
  const scope = yield* Scope.Scope;
  const jobs = new Map<string, Job>();
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  /** Saves a task's outcome, unless the plan moved on while the job was running. */
  const settle = Effect.fn("BuildChecks.settle")(function* (
    threadId: ThreadId,
    taskId: string,
    from: OzoneBuildTask["status"],
    outcome: (build: OzoneBuild, at: string) => OzoneBuild,
  ) {
    const at = yield* now;
    yield* store.modify(threadId, (current) => {
      const task = current?.tasks.find((candidate) => candidate.id === taskId);
      return [null, current === null || task?.status !== from ? null : outcome(current, at)];
    });
  });

  /** Commits the tree for a task and snapshots the data beside it. */
  const keep = Effect.fn("BuildChecks.keep")(function* (
    target: CheckTarget,
    task: OzoneBuildTask,
    evidence: ReadonlyArray<OzoneGateResult>,
  ) {
    const commitSha = yield* repo.commitAll(
      target.app.workspaceRoot,
      `${task.title}\n\nOzone build task ${task.id}.`,
    );
    // A missing snapshot must not undo work that passed; the next task takes another.
    const snapshot = yield* data
      .snapshot({ projectId: target.app.app.projectId, reason: "task", label: task.title })
      .pipe(Effect.option);
    yield* settle(target.threadId, task.id, task.status, (build, at) =>
      BuildModel.passed(
        build,
        task.id,
        {
          commitSha,
          snapshotId: Option.getOrNull(snapshot)?.id ?? null,
          evidence,
          summary: task.summary,
        },
        at,
      ),
    );
  });

  const judgeTask = Effect.fn("BuildChecks.judgeTask")(function* (
    target: CheckTarget,
    taskId: string,
  ) {
    const task = (yield* store.get(target.threadId))?.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (task === undefined || task.status !== "checking") return null;
    const root = target.app.workspaceRoot;
    const { summary } = task;
    if (task.access === "read") {
      if (!(yield* repo.hasChanges(root))) {
        const commitSha = yield* repo.head(root);
        yield* settle(target.threadId, taskId, "checking", (build, at) =>
          BuildModel.passed(
            build,
            taskId,
            { commitSha, snapshotId: null, evidence: [], summary },
            at,
          ),
        );
        return WAKE.taskChecked(task, true);
      }
      // Kept, but out of the tree the next writer starts from.
      yield* repo.setAside(root, `ozone: changes made by read-only task ${taskId}`);
      yield* settle(target.threadId, taskId, "checking", (build, at) =>
        BuildModel.failed(
          build,
          taskId,
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
          at,
        ),
      );
      return WAKE.taskChecked(task, false);
    }
    const outcome = yield* gates.task(target.app, { baseSha: task.baseSha });
    const needsDecision = outcome.needsDecision;
    if (needsDecision !== null) {
      yield* settle(target.threadId, taskId, "checking", (build, at) =>
        BuildModel.blocked(
          build,
          taskId,
          { evidence: outcome.results, summary, reason: needsDecision },
          at,
        ),
      );
      return WAKE.taskChecked(task, false);
    }
    const failed = failures(outcome.results);
    if (failed.length === 0) {
      yield* keep(target, task, outcome.results);
      return WAKE.taskChecked(task, true);
    }
    yield* settle(target.threadId, taskId, "checking", (build, at) =>
      BuildModel.failed(
        build,
        taskId,
        {
          evidence: outcome.results,
          summary,
          reason: `It did not pass ${failed.map((gate) => gate.id).join(", ")}.`,
        },
        at,
      ),
    );
    return WAKE.taskChecked(task, false);
  });

  const judgeFinal = Effect.fn("BuildChecks.judgeFinal")(function* (target: CheckTarget) {
    const startedAt = yield* now;
    const due = yield* store.modify(target.threadId, (current) =>
      current !== null && BuildModel.awaitsFinalCheck(current)
        ? [true, BuildModel.finalStarted(current, startedAt)]
        : [false, null],
    );
    if (!due) return null;
    const evidence = yield* gates.final(target.app);
    const at = yield* now;
    yield* store.modify(target.threadId, (current) => [
      null,
      // A plan revised while the check ran has taken the mark away: this result is of an old plan.
      current?.finalStartedAt === startedAt
        ? BuildModel.finalChecked(
            current,
            evidence,
            { verify: target.app.app.settings.verifyBuilds },
            at,
          )
        : null,
    ]);
    return WAKE.finalChecked(failures(evidence).length === 0);
  });

  const finish = (
    key: string,
    job: Job,
    threadId: ThreadId,
    exit: Exit.Exit<BuildWake.WakeNote | null, OzoneAppError>,
  ) =>
    Effect.suspend(() => {
      // One step with `run` giving up its watch, so exactly one of the two tells the lead.
      job.done = true;
      jobs.delete(key);
      const note = job.watched
        ? null
        : Exit.match(exit, {
            onSuccess: (told) => told,
            onFailure: (cause) => {
              // The server is stopping. The next start picks the check up again.
              if (Cause.hasInterruptsOnly(cause)) return null;
              const error = Cause.squash(cause);
              return WAKE.checkBroke(isAppError(error) ? error.message : "It failed unexpectedly.");
            },
          });
      return Deferred.done(job.result, exit).pipe(
        Effect.andThen(note === null ? Effect.void : wake.wake(threadId, note)),
      );
    });

  const ensure = Effect.fn("BuildChecks.ensure")(function* (
    target: CheckTarget,
    check: Check,
    watched: boolean,
  ) {
    const key = keyOf(target.threadId, check);
    const running = jobs.get(key);
    if (running !== undefined) return running;
    const job: Job = { result: Deferred.makeUnsafe(), watched, done: false };
    jobs.set(key, job);
    const judged = check === "final" ? judgeFinal(target) : judgeTask(target, check.task);
    yield* judged.pipe(
      Effect.onExit((exit) => finish(key, job, target.threadId, exit)),
      Effect.forkIn(scope),
    );
    return job;
  });

  /** Checks that a restart cut short run again, and their lead is woken with the result. */
  const resume = Effect.gen(function* () {
    for (const build of yield* store.list) {
      const cutShort: ReadonlyArray<Check> = [
        ...build.tasks
          .filter((task) => task.status === "checking")
          .map((task) => ({ task: task.id })),
        ...(build.finalStartedAt === null ? [] : ["final" as const]),
      ];
      if (cutShort.length === 0) continue;
      const app = yield* registry.resolve(build.projectId).pipe(Effect.option);
      if (Option.isNone(app)) continue;
      for (const check of cutShort) {
        yield* ensure({ threadId: build.threadId, app: app.value }, check, false);
      }
    }
  });
  yield* resume.pipe(
    Effect.catchCause((cause) => Effect.logWarning("ozone.build.resume-failed", { cause })),
    Effect.forkIn(scope),
  );

  return BuildChecks.of({
    run: Effect.fn("BuildChecks.run")(function* (target, check, patience) {
      const job = yield* ensure(target, check, true);
      job.watched = true;
      // A call that leaves before the result, by its patience or by being interrupted, leaves the
      // telling to the job.
      const leave = () => {
        if (!job.done) job.watched = false;
        return !job.done;
      };
      if (!Duration.isZero(patience)) {
        yield* Deferred.await(job.result).pipe(
          Effect.timeoutOption(patience),
          Effect.onInterrupt(() => Effect.sync(leave)),
        );
      }
      if (leave()) return false;
      yield* Deferred.await(job.result);
      return true;
    }),
    accept: Effect.fn("BuildChecks.accept")(function* (target, taskId) {
      const task = (yield* store.get(target.threadId))?.tasks.find(
        (candidate) => candidate.id === taskId,
      );
      if (task === undefined) return yield* refuse(`There is no task called ${taskId}.`);
      if (task.status !== "blocked") {
        return yield* refuse(
          `Task ${task.id} is ${task.status}, not blocked. Only a blocked task needs a ruling.`,
        );
      }
      // Only the person runs a migration that can lose data, from the app's banner.
      const held = parseHeldBack(
        task.evidence.find((result) => result.id === "migrations")?.detail ?? "",
      );
      const waiting =
        held === null ? null : (yield* runtime.status(target.app.app.projectId)).migration;
      if (waiting !== null) {
        return yield* refuse(
          `Task ${task.id} waits for the user: a migration that can lose data runs only when they apply it from the app's banner in Ozone. Tell them what it does, then accept the task once they have:\n${waiting}`,
        );
      }
      yield* keep(target, task, task.evidence);
    }),
  });
});

export const layer = Layer.effect(BuildChecks, make);
