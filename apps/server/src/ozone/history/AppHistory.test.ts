import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  NO_OZONE_VERIFICATION,
  ProjectId,
  ThreadId,
  type OzoneAppManifest,
  type OzoneBuild,
  type OzoneBuildTask,
  type OzoneSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildRepo from "../builds/BuildRepo.ts";
import * as BuildStore from "../builds/BuildStore.ts";
import * as AppData from "../data/AppData.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as AppHistory from "./AppHistory.ts";

const projectId = ProjectId.make("project-notes");
const threadId = ThreadId.make("lead");

const AT = "2026-01-01T00:00:00.000Z";
const manifest: OzoneAppManifest = {
  version: 1,
  runtime: {
    kind: "compose",
    file: "compose.yaml",
    appService: "app",
    appPort: 3000,
    healthPath: "/api/health",
  },
  gates: [],
  data: { services: [] },
};

const snapshotAt = (id: string, commitSha: string): OzoneSnapshot => ({
  id,
  projectId,
  createdAt: AT,
  reason: "task",
  label: null,
  commitSha,
  sizeBytes: 1,
});

const doneTask = (id: string, commitSha: string): OzoneBuildTask => ({
  id,
  title: `Task ${id}`,
  brief: "",
  dependsOn: [],
  acceptance: [],
  access: "write",
  status: "done",
  attempts: 1,
  dispatches: 1,
  workerTaskId: null,
  workerThreadId: null,
  baseSha: null,
  commitSha,
  snapshotId: null,
  evidence: [],
  summary: null,
  blockedReason: null,
});

/** A real repository with three commits, the scaffold and two tasks, and a build that made them. */
const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-history-" });
  const steps = yield* Ref.make<ReadonlyArray<string>>([]);
  const snapshots = yield* Ref.make<ReadonlyArray<OzoneSnapshot>>([]);
  const record = (step: string) => Ref.update(steps, (all) => [...all, step]);
  // Set to hold the data restore until the test releases it.
  const hold = {
    holding: yield* Ref.make(false),
    reached: yield* Deferred.make<void>(),
    release: yield* Deferred.make<void>(),
  };
  // The last thing a restore does.
  const restarted = yield* Deferred.make<void>();
  // The workspace's files when the app was started again.
  const filesAtStart = yield* Ref.make<ReadonlyArray<string>>([]);

  const data = Layer.mock(AppData.AppData)({
    list: () => Ref.get(snapshots),
    restore: (input) =>
      Effect.gen(function* () {
        if (yield* Ref.get(hold.holding)) {
          yield* Deferred.succeed(hold.reached, undefined);
          yield* Deferred.await(hold.release);
        }
        yield* record(`restore data ${input.snapshotId}`);
        return { safety: snapshotAt("safety", "before") };
      }),
  });
  const runtime = Layer.mock(AppRuntime.AppRuntime)({
    act: (input) =>
      record(input.action).pipe(
        Effect.andThen(
          input.action === "up"
            ? fs.readDirectory(root).pipe(
                Effect.orDie,
                Effect.flatMap((names) =>
                  Ref.set(filesAtStart, names.filter((name) => name !== ".git").toSorted()),
                ),
                Effect.andThen(Deferred.succeed(restarted, undefined)),
              )
            : Effect.void,
        ),
        Effect.as({
          projectId,
          phase: "starting" as const,
          url: null,
          services: [],
          message: null,
          migration: null,
          updatedAt: AT,
        }),
      ),
  });
  const registry = Layer.mock(AppRegistry.AppRegistry)({
    resolve: () =>
      Effect.succeed({
        app: {
          projectId,
          slug: "notes-a1b2c3",
          name: "Notes",
          templateId: "web-app",
          port: 41_000,
          createdAt: AT,
          settings: DEFAULT_OZONE_APP_SETTINGS,
        },
        workspaceRoot: root,
        manifest,
      }),
  });
  const git = GitVcsDriver.layer.pipe(
    Layer.provide(ServerConfig.layerTest(root, { prefix: "ozone-history-config-" })),
    Layer.provideMerge(VcsProcess.layer),
  );
  const context = yield* Layer.build(
    AppHistory.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(BuildRepo.layer, BuildStore.layer)),
      Layer.provideMerge(Layer.mergeAll(git, SqlitePersistence.layerMemory)),
      Layer.provide(Layer.mergeAll(data, runtime, registry)),
    ),
  );
  const history = Context.get(context, AppHistory.AppHistory);
  const repo = Context.get(context, BuildRepo.BuildRepo);
  const store = Context.get(context, BuildStore.BuildStore);
  const driver = Context.get(context, GitVcsDriver.GitVcsDriver);

  const gitRun = (args: ReadonlyArray<string>) =>
    driver.execute({ operation: "test", cwd: root, args, timeoutMs: 30_000 });
  yield* gitRun(["init", "--initial-branch=main"]);
  yield* gitRun(["config", "user.name", "Ozone test"]);
  yield* gitRun(["config", "user.email", "test@example.com"]);
  const commitFile = Effect.fn("test.commitFile")(function* (file: string, subject: string) {
    yield* fs.writeFileString(path.join(root, file), `${file}\n`);
    const sha = yield* repo.commitAll(root, subject);
    if (sha === null) return yield* Effect.die(`could not commit ${subject}`);
    return sha;
  });
  const scaffold = yield* commitFile("README.md", "Scaffold");
  const schema = yield* commitFile("schema.ts", "Task schema");
  const page = yield* commitFile("page.tsx", "Task page");
  yield* Ref.set(snapshots, [snapshotAt("s1", schema), snapshotAt("s2", page)]);

  const build: OzoneBuild = {
    threadId,
    projectId,
    spec: "Notes.",
    acceptance: [],
    tasks: [doneTask("schema", schema), doneTask("page", page)],
    maxAttempts: 3,
    finalEvidence: [],
    completedAt: AT,
    updatedAt: AT,
    approval: "not_needed",
    finalStartedAt: null,
    verification: NO_OZONE_VERIFICATION,
  };
  yield* store.modify(threadId, () => [null, build]);
  const exists = (file: string) => fs.exists(path.join(root, file));
  return {
    history,
    repo,
    store,
    root,
    steps,
    exists,
    fs,
    path,
    hold,
    restarted,
    filesAtStart,
    shas: { scaffold, schema, page },
  };
});

const layerTest = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

it.effect("goes back to a point with its data, keeping what was there as history", () =>
  Effect.gen(function* () {
    const { history, repo, store, root, steps, exists, fs, path, shas, filesAtStart } =
      yield* makeHarness;

    const listed = yield* history.list(projectId);
    assert.deepStrictEqual(
      listed.entries.map((entry) => [entry.subject, entry.snapshot?.id ?? null]),
      [
        ["Task page", "s2"],
        ["Task schema", "s1"],
        ["Scaffold", null],
      ],
    );

    // An edit nobody committed is kept, not lost.
    yield* fs.writeFileString(path.join(root, "page.tsx"), "an unsaved edit\n");
    const restored = yield* history.restore({ projectId, sha: shas.schema });
    // Stopped first, so the app never runs newer code on the older data.
    assert.deepStrictEqual(yield* Ref.get(steps), ["stop", "restore data s1", "up"]);
    assert.deepStrictEqual(yield* Ref.get(filesAtStart), ["README.md", "schema.ts"]);
    assert.strictEqual(restored.safety?.id, "safety");
    assert.isFalse(yield* exists("page.tsx"));
    assert.isTrue(yield* exists("schema.ts"));
    assert.deepStrictEqual(
      (yield* repo.log(root, { limit: 4 })).map((commit) => commit.subject),
      [
        'Restore "Task schema"',
        'Changes before restoring "Task schema"',
        "Task page",
        "Task schema",
      ],
    );
    assert.strictEqual((yield* repo.log(root, { limit: 1 }))[0]?.sha, restored.commitSha);
    // The task whose work was undone goes back into the plan; the one before it stays done.
    const build = yield* store.get(threadId);
    assert.deepStrictEqual(
      build?.tasks.map((task) => [task.id, task.status]),
      [
        ["schema", "done"],
        ["page", "pending"],
      ],
    );

    // Going back to where it was undoes the restore, the unsaved edit and the task with it.
    const before = (yield* repo.log(root, { limit: 2 }))[1];
    if (before === undefined) return assert.fail("the commit before the restore is missing");
    yield* history.restore({ projectId, sha: before.sha });
    assert.strictEqual(yield* fs.readFileString(path.join(root, "page.tsx")), "an unsaved edit\n");
    assert.deepStrictEqual(
      (yield* store.get(threadId))?.tasks.map((task) => task.status),
      ["done", "done"],
    );

    // Where no snapshot was taken, only the code goes back.
    yield* Ref.set(steps, []);
    yield* history.restore({ projectId, sha: shas.scaffold });
    assert.deepStrictEqual(yield* Ref.get(steps), ["stop", "up"]);
    assert.isFalse(yield* exists("schema.ts"));
    assert.deepStrictEqual(
      (yield* store.get(threadId))?.tasks.map((task) => task.status),
      ["pending", "pending"],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses to go back while a build is working on the app", () =>
  Effect.gen(function* () {
    const { history, repo, store, root, steps, shas } = yield* makeHarness;
    yield* store.modify(threadId, (build) => [
      null,
      build === null
        ? null
        : {
            ...build,
            tasks: build.tasks.map((task) =>
              task.id === "page" ? { ...task, status: "running" as const } : task,
            ),
          },
    ]);
    const refused = yield* Effect.flip(history.restore({ projectId, sha: shas.schema }));
    assert.match(refused.message, /A build is working on this app/);
    assert.deepStrictEqual(yield* Ref.get(steps), []);
    assert.strictEqual(yield* repo.head(root), shas.page);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("finishes a restore whose caller went away, code included", () =>
  Effect.gen(function* () {
    const { history, repo, root, hold, restarted, shas } = yield* makeHarness;
    yield* Ref.set(hold.holding, true);
    const restoring = yield* Effect.forkChild(history.restore({ projectId, sha: shas.schema }));
    yield* Deferred.await(hold.reached);
    yield* Fiber.interrupt(restoring);
    yield* Deferred.succeed(hold.release, undefined);
    yield* Deferred.await(restarted);
    assert.strictEqual((yield* repo.log(root, { limit: 1 }))[0]?.subject, 'Restore "Task schema"');
  }).pipe(Effect.provide(layerTest)),
);
