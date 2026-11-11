import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  NodeId,
  ProjectId,
  ThreadId,
  type OzoneAppManifest,
  type OzoneBuildPlanInput,
  type OzoneGateResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import type { McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as AppData from "../data/AppData.ts";
import { NEXT } from "./briefs.ts";
import * as BuildConductor from "./BuildConductor.ts";
import * as BuildGates from "./BuildGates.ts";
import * as BuildRepo from "./BuildRepo.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWorkers from "./BuildWorkers.ts";

const threadId = ThreadId.make("lead-thread");
const projectId = ProjectId.make("project-habits");
const manifest: OzoneAppManifest = {
  version: 1,
  runtime: {
    kind: "compose",
    file: "compose.yaml",
    appService: "app",
    appPort: 3000,
    healthPath: "/api/health",
  },
  gates: [
    { id: "typecheck", command: "npm run typecheck", when: "task" },
    { id: "test", command: "npm run test", when: "task" },
    { id: "build", command: "npm run build", when: "final" },
  ],
  data: { services: [] },
};
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
  readonly workerEndings: ReadonlyArray<BuildWorkers.WorkerStatus>;
  readonly treeHasChanges: boolean;
  readonly lostCommits: ReadonlySet<string>;
}

const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-conductor-" });
  const journal = yield* Ref.make<ReadonlyArray<string>>([]);
  const briefs = yield* Ref.make<ReadonlyArray<string>>([]);
  const script = yield* Ref.make<Script>({
    taskChecks: [],
    finalChecks: [],
    finishesWhileWaiting: true,
    workerEndings: [],
    treeHasChanges: false,
    lostCommits: new Set(),
  });
  const workerStates = yield* Ref.make<ReadonlyMap<string, BuildWorkers.WorkerStatus>>(new Map());
  const commits = yield* Ref.make(0);
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
          yield* Ref.update(workerStates, (all) =>
            new Map(all).set(id, { state: "working", summary: null, ending: null }),
          );
        }
        return { workerTaskId: NodeId.make(id), workerThreadId: ThreadId.make(`thread-of-${id}`) };
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
        if (!current.finishesWhileWaiting) {
          yield* TestClock.adjust(timeout);
          return;
        }
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

  // Built into the test's own scope: the in-memory database must outlive this setup.
  const context = yield* Layer.build(
    BuildConductor.layer.pipe(
      Layer.provideMerge(BuildStore.layer),
      Layer.provide(Layer.mergeAll(workers, gates, repo, data, SqlitePersistence.layerMemory)),
    ),
  );
  const services = {
    conductor: Context.get(context, BuildConductor.BuildConductor),
    store: Context.get(context, BuildStore.BuildStore),
  };
  const lead: BuildConductor.BuildLead = {
    scope,
    threadId,
    patience: Duration.minutes(10),
    app: {
      app: {
        projectId,
        slug: "habits-a1b2c3",
        name: "Habits",
        templateId: "web-app",
        port: 41_000,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      workspaceRoot,
      manifest,
    },
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
    workerStates,
    statuses,
    workspaceRoot,
    fs,
    path,
  };
});

const layerTest = NodeServices.layer;

describe("BuildConductor", () => {
  it.effect("builds a plan task by task: worker, checks, commit, snapshot", () =>
    Effect.gen(function* () {
      const { conductor, lead, steps, fs, path, workspaceRoot } = yield* makeHarness;
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
      assert.strictEqual(report.next, NEXT.complete);
      assert.deepStrictEqual(
        report.tasks.map((entry) => entry.note),
        ["Committed sha-1. schema#1 finished", "Committed sha-2. page#1 finished"],
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("sends a failed task to a fresh worker with the evidence, then to the lead", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, briefs, statuses } = yield* makeHarness;
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
      const { conductor, lead, set, steps, statuses, workerStates } = yield* makeHarness;
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

  it.effect("stops for a decision on a migration that can lose data", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, statuses } = yield* makeHarness;
      yield* conductor.plan(lead, plan(task("schema"), task("page", { dependsOn: ["schema"] })));
      yield* set({
        taskChecks: [
          {
            results: [{ id: "migrations", ok: false, detail: "drizzle/0001.sql:3 drops a table" }],
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

      yield* forget;
      const kept = yield* conductor.resolve(lead, { taskId: "schema", ruling: "accept" });
      assert.deepStrictEqual(yield* steps, ["commit Task schema", "snapshot Task schema"]);
      assert.deepStrictEqual(statuses(kept), { schema: "done", page: "pending" });
      assert.strictEqual((yield* conductor.advance(lead)).status, "complete");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("hands a question back to the lead and retries a worker that ended badly", () =>
    Effect.gen(function* () {
      const { conductor, lead, set, steps, forget, briefs, workerStates } = yield* makeHarness;
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
      const { conductor, lead, set, steps, statuses } = yield* makeHarness;
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

      const { conductor: second, lead: lead2, set: set2, steps: steps2 } = yield* makeHarness;
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
      const { conductor, lead, set, steps, forget, statuses } = yield* makeHarness;
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
      const { conductor, store, lead, set, steps, forget } = yield* makeHarness;
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({ finishesWhileWaiting: false });
      yield* conductor.advance(lead);
      const build = yield* store.get(threadId);
      if (build === null) return assert.fail("the build was not stored");
      // What the store holds if the server stops after the worker finished, mid-check.
      yield* store.put({
        ...build,
        tasks: build.tasks.map((entry) => ({ ...entry, status: "checking", summary: "page done" })),
      });
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
      const { conductor, lead, steps } = yield* makeHarness;
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
      const { conductor, lead, set, steps, forget } = yield* makeHarness;
      yield* conductor.plan(lead, plan(task("page")));
      yield* set({ finalChecks: [[{ id: "build", ok: false, detail: "vite: build failed" }]] });
      const broken = yield* conductor.advance(lead);
      assert.strictEqual(broken.status, "blocked");
      assert.match(broken.next, /the final check failed \(build\)\. Add a task that fixes it/);

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
      const { conductor, lead, set, steps } = yield* makeHarness;
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
});
