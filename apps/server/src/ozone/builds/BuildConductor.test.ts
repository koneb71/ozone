import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  NO_OZONE_VERIFICATION,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OzoneAppSettings,
  type OzoneBuildPlanInput,
  type OzoneGateResult,
  type OzoneWorkerModel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import type { McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppData from "../data/AppData.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { testApp, testManifest } from "../ozone.testkit.ts";
import { NEXT } from "./briefs.ts";
import * as BuildChecks from "./BuildChecks.ts";
import * as BuildConductor from "./BuildConductor.ts";
import * as BuildGates from "./BuildGates.ts";
import * as BuildRepo from "./BuildRepo.ts";
import * as BuildReview from "./BuildReview.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWake from "./BuildWake.ts";
import * as BuildWorkers from "./BuildWorkers.ts";

const threadId = ThreadId.make("lead-thread");
const projectId = ProjectId.make("project-habits");
const manifest = testManifest({
  gates: [
    { id: "typecheck", command: "npm run typecheck", when: "task" },
    { id: "test", command: "npm run test", when: "task" },
    { id: "build", command: "npm run build", when: "final" },
  ],
});
const scope: McpInvocationScope = {
  environmentId: "environment" as McpInvocationScope["environmentId"],
  requestNamespace: "provider-session",
  thread: {
    threadId,
    providerSessionId: "provider-session",
    providerInstanceId: "claude" as NonNullable<McpInvocationScope["thread"]>["providerInstanceId"],
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

type TaskPlan = OzoneBuildPlanInput["tasks"][number];
const task = (id: string, extra: Partial<TaskPlan> = {}): TaskPlan => ({
  id,
  title: `Task ${id}`,
  brief: `Do ${id}.`,
  ...extra,
});
const plan = (...tasks: ReadonlyArray<TaskPlan>): OzoneBuildPlanInput => ({
  spec: "A habit tracker.",
  acceptance: ["A habit can be added."],
  tasks,
});

const PASS: ReadonlyArray<OzoneGateResult> = [
  { id: "typecheck", ok: true, detail: "" },
  { id: "test", ok: true, detail: "" },
];
const FAIL: ReadonlyArray<OzoneGateResult> = [
  { id: "typecheck", ok: false, detail: "src/routes/habits.tsx(4,7): error TS2322" },
  { id: "test", ok: true, detail: "" },
];

interface Script {
  /** What the task checks return, call by call. Runs out to "everything passes". */
  readonly taskChecks: ReadonlyArray<BuildGates.TaskGateOutcome>;
  readonly finalChecks: ReadonlyArray<ReadonlyArray<OzoneGateResult>>;
  /** Whether a worker finishes while the conductor waits for it. */
  readonly finishesWhileWaiting: boolean;
  /** A worker that finishes only as the step's patience runs out. */
  readonly finishesLate: boolean;
  readonly workerEndings: ReadonlyArray<BuildWorkers.WorkerStatus>;
  readonly treeHasChanges: boolean;
  readonly lostCommits: ReadonlySet<string>;
  /** Task checks that take five minutes, longer than a step waits. */
  readonly slowChecks: boolean;
}

// The tester is off unless a test turns it on, so each test reads only the steps it is about.
const makeHarness = (settings: Partial<OzoneAppSettings> = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-conductor-" });
    const journal = yield* Ref.make<ReadonlyArray<string>>([]);
    const briefs = yield* Ref.make<ReadonlyArray<string>>([]);
    const script = yield* Ref.make<Script>({
      taskChecks: [],
      finalChecks: [],
      finishesWhileWaiting: true,
      finishesLate: false,
      workerEndings: [],
      treeHasChanges: false,
      lostCommits: new Set(),
      slowChecks: false,
    });
    const workerStates = yield* Ref.make<ReadonlyMap<string, BuildWorkers.WorkerStatus>>(new Map());
    const commits = yield* Ref.make(0);
    const models = yield* Ref.make<ReadonlyArray<OzoneWorkerModel | null>>([]);
    const wakes = yield* Queue.unbounded<string>();
    const record = (entry: string) => Ref.update(journal, (all) => [...all, entry]);
    const taskOf = (workerId: string) => workerId.split(":")[1] ?? workerId;

    const workers = Layer.succeed(
      BuildWorkers.BuildWorkers,
      BuildWorkers.BuildWorkers.of({
        dispatch: Effect.fn("TestWorkers.dispatch")(function* (_scope, input) {
          // What upstream does with a repeated key in one provider session: the same work.
          const id = `worker:${input.key.split(":").slice(2).join("#")}`;
          const known = (yield* Ref.get(workerStates)).has(id);
          if (!known) {
            yield* record(`dispatch ${input.key.split(":")[2]}`);
            yield* Ref.update(briefs, (all) => [...all, input.brief]);
            yield* Ref.update(models, (all) => [...all, input.model]);
            yield* Ref.update(workerStates, (all) =>
              new Map(all).set(id, { state: "working", summary: null, ending: null }),
            );
          }
          return {
            workerTaskId: NodeId.make(id),
            workerThreadId: ThreadId.make(`thread-of-${id}`),
          };
        }),
        status: (_scope, workerTaskId) =>
          Ref.get(workerStates).pipe(
            Effect.map(
              (all) =>
                all.get(workerTaskId) ?? { state: "failed", summary: null, ending: "cancelled" },
            ),
          ),
        wait: Effect.fn("TestWorkers.wait")(function* (_scope, workerThreadId, timeout) {
          const id = workerThreadId.replace("thread-of-", "");
          yield* record(`wait ${taskOf(id).split("#")[0]}`);
          const current = yield* Ref.get(script);
          if (!current.finishesWhileWaiting || current.finishesLate)
            yield* TestClock.adjust(timeout);
          if (!current.finishesWhileWaiting) return;
          const [ending, ...later] = current.workerEndings;
          yield* Ref.set(script, { ...current, workerEndings: later });
          yield* Ref.update(workerStates, (all) =>
            new Map(all).set(
              id,
              ending ?? { state: "completed", summary: `${taskOf(id)} finished`, ending: null },
            ),
          );
        }),
      }),
    );
    const gates = Layer.succeed(
      BuildGates.BuildGates,
      BuildGates.BuildGates.of({
        task: Effect.fn("TestGates.task")(function* () {
          if ((yield* Ref.get(script)).slowChecks) yield* Effect.sleep(Duration.minutes(5));
          yield* record("check");
          const current = yield* Ref.get(script);
          const [outcome, ...later] = current.taskChecks;
          yield* Ref.set(script, { ...current, taskChecks: later });
          return outcome ?? { results: PASS, needsDecision: null };
        }),
        final: Effect.fn("TestGates.final")(function* () {
          yield* record("final check");
          const current = yield* Ref.get(script);
          const [outcome, ...later] = current.finalChecks;
          yield* Ref.set(script, { ...current, finalChecks: later });
          return outcome ?? [{ id: "build", ok: true, detail: "" }];
        }),
      }),
    );
    const repo = Layer.succeed(
      BuildRepo.BuildRepo,
      BuildRepo.BuildRepo.of({
        head: () => Effect.map(Ref.get(commits), (count) => `sha-${count}`),
        isInHistory: (_root, sha) =>
          Effect.map(Ref.get(script), (current) => !current.lostCommits.has(sha)),
        hasChanges: () => Effect.map(Ref.get(script), (current) => current.treeHasChanges),
        stageAll: () => Effect.void,
        addedSince: () => Effect.succeed([]),
        commitAll: (_root, message) =>
          record(`commit ${message.split("\n")[0]}`).pipe(
            Effect.andThen(Ref.updateAndGet(commits, (count) => count + 1)),
            Effect.map((count) => `sha-${count}`),
          ),
        setAside: (_root, label) => record(`set aside (${label})`),
        log: () => Effect.succeed([]),
        restoreTree: () => Effect.succeed(null),
        exportTree: () => Effect.succeed(null),
      }),
    );
    const data = Layer.mock(AppData.AppData)({
      snapshot: (input) =>
        record(`snapshot ${input.label}`).pipe(
          Effect.as({
            id: `snapshot-of-${input.label}`,
            projectId,
            createdAt: "2026-01-01T00:00:00.000Z",
            reason: input.reason,
            label: input.label ?? null,
            commitSha: null,
            sizeBytes: 1,
          }),
        ),
    });

    // What the app's banner shows as waiting for the user, until they apply it there.
    const waitingMigration = yield* Ref.make<string | null>(null);
    const runtime = Layer.mock(AppRuntime.AppRuntime)({
      status: () =>
        Ref.get(waitingMigration).pipe(
          Effect.map((migration) => ({
            projectId,
            phase: "running" as const,
            url: null,
            services: [],
            message: null,
            migration,
            updatedAt: "2026-01-01T00:00:00.000Z",
          })),
        ),
    });

    const wake = Layer.succeed(
      BuildWake.BuildWake,
      BuildWake.BuildWake.of({
        wake: (_threadId, note) =>
          record(`wake ${note.summary}`).pipe(Effect.andThen(Queue.offer(wakes, note.summary))),
      }),
    );
    const app: AppRegistry.ResolvedApp = {
      app: testApp({
        projectId,
        slug: "habits-a1b2c3",
        name: "Habits",
        settings: { ...DEFAULT_OZONE_APP_SETTINGS, verifyBuilds: false, ...settings },
      }),
      workspaceRoot,
      manifest,
    };
    const registry = Layer.mock(AppRegistry.AppRegistry)({ resolve: () => Effect.succeed(app) });
    const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: () => Effect.succeed({ projectId } as never),
    });

    // Built into the test's own scope: the in-memory database must outlive this setup.
    const context = yield* Layer.build(
      BuildConductor.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(BuildChecks.layer, BuildReview.layer)),
        Layer.provideMerge(Layer.mergeAll(BuildStore.layer, wake, registry, threads)),
        Layer.provideMerge(
          Layer.mergeAll(workers, gates, repo, data, runtime, SqlitePersistence.layerMemory),
        ),
      ),
    );
    const services = {
      conductor: Context.get(context, BuildConductor.BuildConductor),
      store: Context.get(context, BuildStore.BuildStore),
      review: Context.get(context, BuildReview.BuildReview),
    };
    /** What a server restart does to the checks: a new instance, which looks for cut-short work. */
    const restart = Layer.build(
      BuildChecks.layer.pipe(Layer.provide(Layer.succeedContext(context))),
    );
    const lead: BuildConductor.BuildLead = {
      scope,
      threadId,
      patience: Duration.minutes(10),
      app,
      planning: false,
    };
    const set = (change: Partial<Script>) =>
      Ref.update(script, (current) => ({ ...current, ...change }));
    const steps = Ref.get(journal);
    const forget = Ref.set(journal, []);
    const statuses = (report: { readonly tasks: ReadonlyArray<{ id: string; status: string }> }) =>
      Object.fromEntries(report.tasks.map((entry) => [entry.id, entry.status]));
    return {
      ...services,
      lead,
      set,
      steps,
      forget,
      briefs,
      models,
      wakes,
      restart,
      workerStates,
      statuses,
      waitingMigration,
      workspaceRoot,
      fs,
      path,
    };
  });

const layerTest = NodeServices.layer;

describe("BuildConductor", () => {
  it.effect("builds a plan task by task: worker, checks, commit, snapshot", () =>
    Effect.gen(function* () {
      const { conductor, lead, steps, fs, path, workspaceRoot } = yield* makeHarness();
      assert.strictEqual((yield* conductor.get(lead)).next, NEXT.plan);
      const planned = yield* conductor.plan(
        lead,
        plan(task("schema"), task("page", { dependsOn: ["schema"] })),
      );
      assert.strictEqual(planned.next, NEXT.planned);
      // Workers are pointed at these files instead of being sent the whole plan.
      assert.include(
        yield* fs.readFileString(path.join(workspaceRoot, ".ozone", "plan.md")),
        "## 2. Task page (`page`)",
      );

      const report = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, [
        "dispatch schema",
        "wait schema",
        "check",
        "commit Task schema",
        "snapshot Task schema",
        "dispatch page",
        "wait page",
        "check",
        "commit Task page",
        "snapshot Task page",
        "final check",
      ]);
      assert.strictEqual(report.status, "complete");
      assert.strictEqual(
        report.next,
        NEXT.complete("http://localhost:41000", NO_OZONE_VERIFICATION),
      );
      assert.deepStrictEqual(
        report.tasks.map((entry) => entry.note),
        ["Committed sha-1. schema#1 finished", "Committed sha-2. page#1 finished"],
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("sends a failed task to a fresh worker with the evidence, then to the lead", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, briefs, statuses } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page", { acceptance: ["A habit can be added."] })));
      const failing = { results: FAIL, needsDecision: null };
      yield* set({ taskChecks: [failing, failing, failing] });

      const report = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, [
        "dispatch page",
        "wait page",
        "check",
        "dispatch page",
        "wait page",
        "check",
        "dispatch page",
        "wait page",
        "check",
      ]);
      assert.strictEqual(report.status, "blocked");
      assert.include(report.next, "ozone_build_resolve");
      assert.include(report.tasks[0]?.note ?? "", "It has been tried 3 times.");
      assert.include(report.tasks[0]?.note ?? "", "error TS2322");

      const [first, second] = yield* Ref.get(briefs);
      assert.match(first ?? "", /^Ozone task 1 of 1: Task page\n\nDo page\./);
      assert.include(first ?? "", "It is done when:\n- A habit can be added.");
      assert.notInclude(first ?? "", "attempt");
      assert.include(second ?? "", "This is attempt 2 of 3. The last attempt did not pass:");
      assert.include(second ?? "", "- typecheck: src/routes/habits.tsx(4,7): error TS2322");
      assert.include(second ?? "", "The last worker reported: page#1 finished");

      // The lead's ruling restarts the count, and its note reaches the next worker.
      yield* forget;
      const ruled = yield* conductor.resolve(lead, {
        taskId: "page",
        ruling: "retry",
        note: "Type the loader's return value.",
      });
      assert.deepStrictEqual(statuses(ruled), { page: "pending" });
      const done = yield* conductor.advance(lead);
      assert.strictEqual(done.status, "complete");
      assert.include(
        (yield* Ref.get(briefs)).at(-1) ?? "",
        "- lead: Type the loader's return value.",
      );
      assert.deepStrictEqual(yield* steps, [
        "dispatch page",
        "wait page",
        "check",
        "commit Task page",
        "snapshot Task page",
        "final check",
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("gives the call back when its patience ends, and resumes without a second worker", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, statuses, workerStates } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("schema"), task("page", { dependsOn: ["schema"] })));
      yield* set({ finishesWhileWaiting: false });

      const waiting = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, ["dispatch schema", "wait schema"]);
      assert.deepStrictEqual(statuses(waiting), { schema: "running", page: "pending" });
      assert.match(waiting.next, /^A worker is still on task schema\. End your turn now\./);
      assert.isDefined(waiting.tasks[0]?.workerThreadId);

      // Called again while the worker is still busy: it waits again and starts nothing.
      yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, ["dispatch schema", "wait schema", "wait schema"]);

      // The worker finishes while nobody waits; the next call picks its result up.
      yield* Ref.update(
        workerStates,
        (all) =>
          new Map(
            [...all].map(([id, status]) => [
              id,
              { ...status, state: "completed", summary: "done" },
            ]),
          ),
      );
      yield* set({ finishesWhileWaiting: true });
      const report = yield* conductor.advance(lead);
      assert.strictEqual(report.status, "complete");
      assert.deepStrictEqual(
        (yield* steps).filter((step) => step.startsWith("dispatch")),
        ["dispatch schema", "dispatch page"],
      );
    }).pipe(Effect.provide(layerTest)),
  );

  // The lead's harness can put a long call in the background and end the lead's turn, and
  // upstream starts a worker only for a lead whose turn is running.
  it.effect("starts no more work in a step that has used its patience", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, wakes } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("schema"), task("page", { dependsOn: ["schema"] })));
      yield* set({ finishesLate: true });

      const report = yield* conductor.advance(lead);
      assert.match(report.next, /^Ozone is checking task schema\. End your turn now\./);
      // The checks need no worker, so they go on after the step, and wake the lead when done.
      assert.strictEqual(yield* Queue.take(wakes), "Checks passed: Task schema");
      assert.deepStrictEqual(yield* steps, [
        "dispatch schema",
        "wait schema",
        "check",
        "commit Task schema",
        "snapshot Task schema",
        "wake Checks passed: Task schema",
      ]);

      yield* set({ finishesLate: false });
      assert.strictEqual((yield* conductor.advance(lead)).status, "complete");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "lets a check outlast the step that started it, and wakes the lead with the result",
    () =>
      Effect.gen(function* () {
        const { conductor, lead, set, steps, forget, wakes } = yield* makeHarness();
        yield* conductor.plan(lead, plan(task("page")));
        yield* set({ slowChecks: true });

        const step = yield* Effect.forkChild(
          conductor.advance({ ...lead, patience: Duration.minutes(1) }),
        );
        yield* TestClock.adjust(Duration.minutes(1));
        const report = yield* Fiber.join(step);
        assert.match(report.next, /^Ozone is checking task page\. End your turn now\./);
        assert.deepStrictEqual(yield* steps, ["dispatch page", "wait page"]);

        yield* TestClock.adjust(Duration.minutes(5));
        assert.strictEqual(yield* Queue.take(wakes), "Checks passed: Task page");
        assert.deepStrictEqual((yield* steps).slice(2), [
          "check",
          "commit Task page",
          "snapshot Task page",
          "wake Checks passed: Task page",
        ]);

        // The woken lead finds the task done and finishes the build; the checks are not run twice.
        yield* forget;
        yield* set({ slowChecks: false });
        assert.strictEqual((yield* conductor.advance(lead)).status, "complete");
        assert.deepStrictEqual(yield* steps, ["final check"]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("wakes the lead for a check whose call was cut off", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, wakes } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({ slowChecks: true });
      const step = yield* Effect.forkChild(conductor.advance(lead));
      yield* TestClock.adjust(Duration.minutes(1));
      yield* Fiber.interrupt(step);
      yield* TestClock.adjust(Duration.minutes(5));
      assert.strictEqual(yield* Queue.take(wakes), "Checks passed: Task page");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("picks up a check that a restart cut short, and wakes the lead", () =>
    Effect.gen(function* () {
      const { conductor, store, lead, set, steps, forget, wakes, restart } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({ finishesWhileWaiting: false });
      yield* conductor.advance(lead);
      // What the store holds if the server stops after the worker finished, mid-check.
      yield* store.modify(threadId, (build) => [
        undefined,
        build === null
          ? null
          : {
              ...build,
              tasks: build.tasks.map((entry) => ({
                ...entry,
                status: "checking" as const,
                summary: "page done",
              })),
            },
      ]);
      yield* forget;

      yield* restart;
      assert.strictEqual(yield* Queue.take(wakes), "Checks passed: Task page");
      assert.deepStrictEqual(yield* steps, [
        "check",
        "commit Task page",
        "snapshot Task page",
        "wake Checks passed: Task page",
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("stops for a decision on a migration that can lose data", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, statuses, waitingMigration } =
        yield* makeHarness();
      yield* conductor.plan(lead, plan(task("schema"), task("page", { dependsOn: ["schema"] })));
      yield* set({
        taskChecks: [
          {
            results: [
              {
                id: "migrations",
                ok: false,
                detail: "drizzle/0001.sql:3 drops a table: DROP TABLE x\nozone-accept 0001.sql@abc",
              },
            ],
            needsDecision: "A new migration can lose data.\ndrizzle/0001.sql:3 drops a table",
          },
        ],
      });

      const stopped = yield* conductor.advance(lead);
      // No second worker: another attempt cannot decide this.
      assert.deepStrictEqual(yield* steps, ["dispatch schema", "wait schema", "check"]);
      assert.deepStrictEqual(statuses(stopped), { schema: "blocked", page: "pending" });
      assert.include(stopped.next, "A new migration can lose data.");
      assert.include(stopped.next, "Ask the user first only if the choice changes what they get.");

      // The lead cannot run it: only the user does, from the app's banner.
      yield* forget;
      yield* Ref.set(waitingMigration, "drizzle/0001.sql:3 drops a table: DROP TABLE x");
      const refused = yield* Effect.flip(
        conductor.resolve(lead, { taskId: "schema", ruling: "accept" }),
      );
      assert.include(refused.message, "apply it from the app's banner");
      assert.deepStrictEqual(yield* steps, []);

      yield* Ref.set(waitingMigration, null);
      const kept = yield* conductor.resolve(lead, { taskId: "schema", ruling: "accept" });
      assert.deepStrictEqual(yield* steps, ["commit Task schema", "snapshot Task schema"]);
      assert.deepStrictEqual(statuses(kept), { schema: "done", page: "pending" });
      assert.strictEqual((yield* conductor.advance(lead)).status, "complete");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("hands a question back to the lead and retries a worker that ended badly", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, briefs, workerStates } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({
        workerEndings: [
          { state: "waiting_for_answer", summary: null, ending: null },
          { state: "failed", summary: null, ending: "interrupted" },
        ],
      });
      const asked = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, ["dispatch page", "wait page"]);
      assert.include(asked.next, "is waiting for an answer in its thread thread-of-worker:page#1");

      // The question is answered, so the worker is busy again.
      yield* Ref.update(
        workerStates,
        (all) => new Map([...all].map(([id, status]) => [id, { ...status, state: "working" }])),
      );
      yield* forget;
      const report = yield* conductor.advance(lead);
      // The first worker was interrupted, so the task went to a second one.
      assert.deepStrictEqual(yield* steps, [
        "wait page",
        "dispatch page",
        "wait page",
        "check",
        "commit Task page",
        "snapshot Task page",
        "final check",
      ]);
      assert.strictEqual(report.status, "complete");
      assert.include(
        (yield* Ref.get(briefs)).at(-1) ?? "",
        "- Its worker stopped before finishing.",
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("runs read-only tasks together and sets aside anything they changed", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, statuses } = yield* makeHarness();
      yield* conductor.plan(
        lead,
        plan(
          task("research", { access: "read" }),
          task("review", { access: "read" }),
          task("schema", { dependsOn: ["research", "review"] }),
        ),
      );
      yield* set({ finishesWhileWaiting: false });
      const started = yield* conductor.advance(lead);
      // Both readers start before anything is waited for; the writer does not.
      assert.deepStrictEqual((yield* steps).slice(0, 2), ["dispatch research", "dispatch review"]);
      assert.deepStrictEqual(statuses(started), {
        research: "running",
        review: "running",
        schema: "pending",
      });

      const { conductor: second, lead: lead2, set: set2, steps: steps2 } = yield* makeHarness();
      yield* second.plan(lead2, plan(task("research", { access: "read" })));
      yield* set2({ treeHasChanges: true });
      const report = yield* second.advance(lead2);
      assert.deepStrictEqual((yield* steps2).slice(0, 3), [
        "dispatch research",
        "wait research",
        "set aside (ozone: changes made by read-only task research)",
      ]);
      // Never committed, never checked as if it were a writer's work.
      assert.notInclude((yield* steps2).join("|"), "commit");
      assert.strictEqual(report.status, "blocked");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("reopens tasks whose commits were rolled back", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, statuses } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("schema"), task("page", { dependsOn: ["schema"] })));
      assert.strictEqual((yield* conductor.advance(lead)).status, "complete");

      // The user restored the checkpoint from before the second task.
      yield* set({ lostCommits: new Set(["sha-2"]) });
      yield* forget;
      const report = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, [
        "dispatch page",
        "wait page",
        "check",
        "commit Task page",
        "snapshot Task page",
        "final check",
      ]);
      assert.deepStrictEqual(statuses(report), { schema: "done", page: "done" });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("checks again, without a new worker, after a restart in the middle of the checks", () =>
    Effect.gen(function* () {
      const { conductor, store, lead, set, steps, forget } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({ finishesWhileWaiting: false });
      yield* conductor.advance(lead);
      const build = yield* store.get(threadId);
      if (build === null) return assert.fail("the build was not stored");
      // What the store holds if the server stops after the worker finished, mid-check.
      yield* store.modify(threadId, () => [
        undefined,
        {
          ...build,
          tasks: build.tasks.map((entry) => ({
            ...entry,
            status: "checking" as const,
            summary: "page done",
          })),
        },
      ]);
      yield* forget;
      const report = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, [
        "check",
        "commit Task page",
        "snapshot Task page",
        "final check",
      ]);
      assert.strictEqual(report.tasks[0]?.note, "Committed sha-1. page done");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("never hands one task to two workers when called twice at once", () =>
    Effect.gen(function* () {
      const { conductor, lead, steps } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page")));
      const [first, second] = yield* Effect.all(
        [conductor.advance(lead), conductor.advance(lead)],
        {
          concurrency: 2,
        },
      );
      assert.deepStrictEqual(
        (yield* steps).filter((step) => step.startsWith("dispatch") || step.startsWith("commit")),
        ["dispatch page", "commit Task page"],
      );
      assert.strictEqual(first.status, "complete");
      assert.strictEqual(second.status, "complete");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("is not complete until the final check passes", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget } = yield* makeHarness();
      yield* conductor.plan(lead, plan(task("page")));
      const failing = [{ id: "build", ok: false, detail: "vite: build failed" }];
      yield* set({ finalChecks: [failing, failing] });
      const broken = yield* conductor.advance(lead);
      assert.strictEqual(broken.status, "blocked");
      assert.match(broken.next, /the final check failed \(build\)\.\nbuild: vite: build failed\n/);
      assert.include(broken.next, "Add a task that fixes it with ozone_build_plan");

      // The task checks pass on this tree, but the build is still stopped by its final check.
      yield* forget;
      const checked = yield* conductor.check(lead);
      assert.deepStrictEqual(yield* steps, ["check", "final check"]);
      assert.deepStrictEqual(checked.gates, [...PASS, ...failing]);
      assert.strictEqual(checked.next, broken.next);

      yield* forget;
      yield* conductor.plan(lead, plan(task("page"), task("fix-build")));
      const fixed = yield* conductor.advance(lead);
      assert.strictEqual(fixed.status, "complete");
      // The finished task is not redone.
      assert.deepStrictEqual(
        (yield* steps).filter((step) => step.startsWith("dispatch")),
        ["dispatch fix-build"],
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a plan that cannot run and checks a tree without committing it", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps } = yield* makeHarness();
      const refused = yield* Effect.flip(
        conductor.plan(lead, plan(task("page", { dependsOn: ["schema"] }))),
      );
      assert.strictEqual(refused.message, "Task page depends on schema, which is not in the plan.");

      yield* set({ taskChecks: [{ results: FAIL, needsDecision: null }] });
      const checked = yield* conductor.check(lead);
      assert.deepStrictEqual(checked.gates, FAIL);
      assert.match(checked.next, /^Fix what failed \(typecheck\)/);
      assert.deepStrictEqual(yield* steps, ["check"]);
      assert.strictEqual((yield* conductor.check(lead)).next, "Every check passes.");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("has a tester use the finished app, and holds the build on what it finds", () =>
    Effect.gen(function* () {
      const workerModel = {
        providerInstanceId: ProviderInstanceId.make("claude"),
        model: "claude-haiku-4-5",
      };
      const { conductor, lead, set, steps, forget, briefs, models } = yield* makeHarness({
        verifyBuilds: true,
        workerModel,
      });
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({
        workerEndings: [
          { state: "completed", summary: "page finished", ending: null },
          { state: "completed", summary: "Tried it.\nFAIL 1: there is no form", ending: null },
          { state: "completed", summary: "PASS 1", ending: null },
        ],
      });

      const failed = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, [
        "dispatch page",
        "wait page",
        "check",
        "commit Task page",
        "snapshot Task page",
        "final check",
        "dispatch verification",
        "wait verification",
      ]);
      assert.strictEqual(failed.status, "blocked");
      assert.include(failed.next, "- A habit can be added.: there is no form");
      const brief = (yield* Ref.get(briefs)).at(-1) ?? "";
      assert.match(brief, /^Ozone verify/);
      assert.include(brief, `port: ${lead.app.app.port}`);
      // Workers and the tester run on the model the app's settings name.
      assert.deepStrictEqual(yield* Ref.get(models), [workerModel, workerModel]);

      // The lead says the tester was wrong: it tries the app again, and passes this time.
      yield* forget;
      yield* conductor.resolve(lead, { taskId: "verification", ruling: "retry" });
      const passed = yield* conductor.advance(lead);
      assert.deepStrictEqual(yield* steps, ["dispatch verification", "wait verification"]);
      assert.strictEqual(passed.status, "complete");
      assert.include(passed.next, "A tester used the app in a browser");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("starts no work on a reviewed plan until the person approves it", () =>
    Effect.gen(function* () {
      const { conductor, review, lead, steps, wakes } = yield* makeHarness({ reviewPlans: true });
      const planned = yield* conductor.plan(lead, plan(task("page")));
      assert.strictEqual(planned.status, "review");
      assert.strictEqual(planned.next, NEXT.review);
      // The lead has no way to start it: asking again changes nothing.
      assert.strictEqual((yield* conductor.advance(lead)).status, "review");
      assert.strictEqual((yield* conductor.advance(lead)).status, "review");
      assert.deepStrictEqual(yield* steps, []);

      // Approving from the build card wakes the lead, which then builds.
      yield* review.approve(threadId);
      assert.strictEqual(yield* Queue.take(wakes), "Plan approved");
      assert.strictEqual((yield* conductor.advance(lead)).status, "complete");

      // A plan the person approved in the thread, in plan mode, is not asked about again here.
      const shown = yield* makeHarness({ reviewPlans: true });
      const refused = yield* shown.conductor.plan(
        { ...shown.lead, planning: true },
        plan(task("page")),
      );
      assert.strictEqual(refused.next, NEXT.planning);
      assert.deepStrictEqual(refused.tasks, []);
      yield* shown.review.grant(threadId);
      assert.strictEqual(
        (yield* shown.conductor.plan(shown.lead, plan(task("page")))).status,
        "building",
      );
      // One approval covers one plan: what the lead adds next waits.
      assert.strictEqual(
        (yield* shown.conductor.plan(shown.lead, plan(task("page"), task("extra")))).status,
        "review",
      );

      // A later request adds a task to the finished build. It waits like the first plan did.
      const before = yield* steps;
      const revised = yield* conductor.plan(lead, plan(task("page"), task("footer")));
      assert.strictEqual(revised.status, "review");
      assert.strictEqual((yield* conductor.advance(lead)).status, "review");
      assert.deepStrictEqual(yield* steps, before);
      yield* review.approve(threadId);
      assert.strictEqual(yield* Queue.take(wakes), "Plan approved");
      assert.strictEqual((yield* conductor.advance(lead)).status, "complete");
    }).pipe(Effect.provide(layerTest)),
  );
});
