import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  OzoneAppError,
  OzoneAppManifest,
  ProjectId,
  type OzoneApp,
  type OzoneSnapshot,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../../config.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppData from "../data/AppData.ts";
import * as AppDeploy from "../deploy/AppDeploy.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { testApp } from "../ozone.testkit.ts";
import { OZONE_APP_INSTRUCTIONS } from "./appInstructions.ts";
import * as AppRegistry from "./AppRegistry.ts";
import * as OzoneApps from "./OzoneApps.ts";

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(OzoneAppManifest));

const lastSnapshot: OzoneSnapshot = {
  id: "20260101T000000000Z-a1b2c3d4",
  projectId: ProjectId.make("a1b2c3-project-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
  reason: "before-delete",
  label: null,
  commitSha: null,
  sizeBytes: 1,
};

const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-apps-" });
  const registered = yield* Ref.make<ReadonlyArray<OzoneApp>>([]);
  const created = yield* Ref.make(0);
  const commits = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
  const started = yield* Queue.unbounded<ProjectId>();
  const removal = yield* Ref.make<ReadonlyArray<string>>([]);
  const backupFails = yield* Ref.make(false);
  // Puts a file where the new app's folder should be, so the template cannot be written.
  const folderIsAFile = yield* Ref.make(false);
  const record = (step: string) => Ref.update(removal, (all) => [...all, step]);
  // Whether the app's production is running where it was deployed.
  const deployedState = yield* Ref.make<"none" | "running">("none");
  /** The app the delete and restore cases work on, as the registry knows it. */
  const habits = testApp({
    projectId: ProjectId.make("a1b2c3-project-1"),
    slug: "habits-a1b2c3",
    name: "Habits",
  });
  const habitsRoot = path.join(root, "habits");
  // Built once, so the test sees the state folder the service writes to.
  const configContext = yield* Layer.build(
    ServerConfig.layerTest(root, { prefix: "ozone-apps-home-" }),
  );
  const settingsContext = yield* Layer.build(ServerSettings.layerTest());
  const settings = Context.get(settingsContext, ServerSettings.ServerSettingsService);
  const backups = path.join(
    Context.get(configContext, ServerConfig.ServerConfig).stateDir,
    "ozone",
    "backups",
  );

  const apps = yield* OzoneApps.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(AppRegistry.AppRegistry)({
          list: Ref.get(registered),
          register: (app) => Ref.update(registered, (all) => [...all, app]),
          resolve: (projectId) =>
            Effect.succeed({
              app: { ...habits, projectId },
              workspaceRoot: habitsRoot,
              manifest: {} as never,
            }),
          unregister: (projectId) =>
            record("forget the app").pipe(
              Effect.andThen(
                Ref.update(registered, (all) => all.filter((app) => app.projectId !== projectId)),
              ),
            ),
        }),
        Layer.mock(AppData.AppData)({
          remove: Effect.fn("TestData.remove")(function* () {
            if (yield* Ref.get(backupFails)) {
              return yield* new OzoneAppError({ reason: "failed", message: "Could not dump." });
            }
            yield* record("snapshot, then remove containers and volumes");
            return { snapshot: lastSnapshot };
          }),
          revive: () => record("load its last snapshot").pipe(Effect.as(lastSnapshot)),
        }),
        Layer.mock(AppDeploy.AppDeploy)({
          status: () =>
            Ref.get(deployedState).pipe(
              Effect.map((state) => ({
                state,
                target: null,
                url: null,
                commitSha: null,
                deployedAt: null,
                message: null,
                migration: null,
                headSha: null,
              })),
            ),
        }),
        Layer.mock(ProjectService.ProjectService)({
          delete: (input) =>
            record(`delete the project${input.force === true ? " and its threads" : ""}`).pipe(
              Effect.as({} as never),
            ),
          bootstrap: (input) =>
            record("make a project for its folder").pipe(
              Effect.as({ project: { id: input.projectId } as never, created: true }),
            ),
          // The project of an app deleted before Ozone kept a record of deleted apps.
          getById: (projectId) =>
            Effect.succeed(
              projectId === "old-project"
                ? Option.some({
                    id: projectId,
                    title: "Old app",
                    workspaceRoot: path.join(root, "old-app"),
                    createdAt: "2025-12-01T00:00:00.000Z",
                    deletedAt: "2025-12-24T00:00:00.000Z",
                  } as never)
                : Option.none(),
            ),
        }),
        Layer.succeedContext(configContext),
        Layer.succeedContext(settingsContext),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: root,
          createNamedProject: Effect.fn("TestFolders.createNamedProject")(function* (input) {
            const index = yield* Ref.updateAndGet(created, (count) => count + 1);
            const workspaceRoot = path.join(
              input.parent ?? root,
              input.name.toLowerCase().replaceAll(" ", "-"),
            );
            yield* (
              (yield* Ref.get(folderIsAFile))
                ? fs.writeFileString(workspaceRoot, "in the way")
                : fs.makeDirectory(workspaceRoot, { recursive: true })
            ).pipe(Effect.orDie);
            return { projectId: ProjectId.make(`a1b2c3-project-${index}`), workspaceRoot };
          }),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          execute: (input) =>
            Ref.update(commits, (all) => [...all, input.args]).pipe(
              Effect.as({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            ),
        }),
        Layer.mock(NetService.NetService)({
          // Something else on this machine already listens on the second port of the range.
          isPortAvailableOnLoopback: (port) => Effect.succeed(port !== 41_001),
        }),
        Layer.mock(AppRuntime.AppRuntime)({
          docker: Effect.succeed({
            available: true,
            version: "29.0.0",
            message: null,
            problem: null,
          }),
          act: (input) =>
            record("start it").pipe(
              Effect.andThen(Queue.offer(started, input.projectId)),
              Effect.andThen(Effect.never),
            ),
        }),
      ),
    ),
  );
  return {
    apps,
    root,
    registered,
    created,
    commits,
    started,
    fs,
    path,
    removal,
    backupFails,
    folderIsAFile,
    deployedState,
    settings,
    habits,
    habitsRoot,
    backups,
  };
});

it.effect("OzoneApps creates an app from the template, registers it and starts it", () =>
  Effect.gen(function* () {
    const { apps, root, registered, commits, started, settings, fs, path } = yield* makeHarness;

    assert.strictEqual((yield* apps.list).defaultDirectory, root);
    const first = yield* apps.create({ name: "Habit tracker" });
    assert.deepStrictEqual(
      { ...first.app, createdAt: "" },
      {
        projectId: ProjectId.make("a1b2c3-project-1"),
        slug: "habit-tracker-a1b2c3",
        name: "Habit tracker",
        templateId: "web-app",
        port: 41_000,
        createdAt: "",
        settings: DEFAULT_OZONE_APP_SETTINGS,
      },
    );
    assert.deepStrictEqual(yield* Ref.get(registered), [first.app]);
    assert.strictEqual(yield* Queue.take(started), first.app.projectId);
    // This machine's Git has no identity, so the app's own repository gets one before it commits.
    assert.deepStrictEqual(
      (yield* Ref.get(commits)).map((args) =>
        args
          .filter((arg) => !arg.startsWith("-") && !arg.includes("="))
          .slice(0, 2)
          .join(" "),
      ),
      [
        "config user.email",
        "config user.name",
        "config user.email",
        "add",
        "commit Scaffold from the Ozone web-app template",
      ],
    );

    const read = (file: string) => fs.readFileString(path.join(first.workspaceRoot, file));
    assert.include(yield* read(".env"), "OZONE_APP_PORT=41000\n");
    assert.match(yield* read(".env"), /^BETTER_AUTH_SECRET=[0-9a-f]{64}$/m);
    assert.match(yield* read("compose.yaml"), /^name: habit-tracker-a1b2c3$/m);
    assert.include(yield* read("package.json"), '"name": "habit-tracker-a1b2c3"');
    assert.include(yield* read("src/lib/site.ts"), 'name: "Habit tracker"');
    assert.include(yield* read("AGENTS.md"), `## Ozone\n\n${OZONE_APP_INSTRUCTIONS}`);
    assert.strictEqual((yield* fs.stat(path.join(first.workspaceRoot, "dev"))).mode & 0o111, 0o111);

    // What the runtime, the gates and the snapshots read must match the template's real files.
    const manifest = yield* decodeManifest(yield* read("ozone.json"));
    const compose = yield* read("compose.yaml");
    assert.isTrue(yield* fs.exists(path.join(first.workspaceRoot, manifest.runtime.file)));
    assert.match(compose, new RegExp(`^  ${manifest.runtime.appService}:$`, "m"));
    for (const data of manifest.data.services) {
      assert.match(compose, new RegExp(`^  ${data.service}:$`, "m"));
      assert.match(
        compose,
        new RegExp(`^  ${data.volume}:\\n    labels:\\n      ozone.data: "true"$`, "m"),
      );
    }
    const packageJson: unknown = JSON.parse(yield* read("package.json"));
    for (const gate of manifest.gates) {
      const script = /^npm run ([\w:-]+)$/.exec(gate.command)?.[1] ?? "";
      assert.nestedProperty(packageJson, `scripts.${script}`);
    }

    // No placeholder survives in any file.
    const files = yield* fs.readDirectory(first.workspaceRoot, { recursive: true });
    for (const file of files) {
      const target = path.join(first.workspaceRoot, file);
      if ((yield* fs.stat(target)).type !== "File") continue;
      const text = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => ""));
      assert.notMatch(text, /__OZONE_|<!-- ozone:/, file);
    }

    // The next app skips the first app's port and the one another program holds.
    const second = yield* apps.create({ name: "Recipe box" });
    assert.strictEqual(second.app.port, 41_002);
    assert.strictEqual(second.workspaceRoot, path.join(root, "recipe-box"));

    // Once a place is chosen, new apps go there and the earlier ones stay where they are.
    const chosen = path.join(root, "my apps");
    yield* settings.updateSettings({ appsDirectory: chosen });
    const third = yield* apps.create({ name: "Reading list" });
    assert.strictEqual(third.workspaceRoot, path.join(chosen, "reading-list"));
    assert.isTrue(yield* fs.exists(path.join(first.workspaceRoot, "ozone.json")));
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("OzoneApps leaves nothing behind when it cannot make an app", () =>
  Effect.gen(function* () {
    const { apps, created, registered, removal, folderIsAFile, fs, path, root } =
      yield* makeHarness;
    const error = yield* Effect.flip(apps.create({ name: "Habits", templateId: "mobile-app" }));
    assert.strictEqual(error.reason, "unknown_template");
    assert.strictEqual(yield* Ref.get(created), 0);

    // Once its project exists, a failure takes back the project and the folder made for it.
    yield* Ref.set(folderIsAFile, true);
    yield* Effect.flip(apps.create({ name: "Habits" }));
    assert.deepStrictEqual(yield* Ref.get(removal), ["delete the project and its threads"]);
    assert.deepStrictEqual(yield* Ref.get(registered), []);
    assert.isFalse(yield* fs.exists(path.join(root, "habits")));
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("OzoneApps deletes an app behind a snapshot, and can bring it back", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    const { apps, removal, backupFails, deployedState, habits, habitsRoot, fs, path, root } =
      harness;
    const { projectId } = habits;
    yield* fs.makeDirectory(habitsRoot);
    yield* fs.writeFileString(path.join(habitsRoot, "ozone.json"), "{}");
    yield* fs.writeFileString(path.join(habitsRoot, ".env"), "OZONE_APP_PORT=41000\nA=1\n");
    yield* Ref.set(harness.registered, [habits]);

    // Nothing is forgotten while the data could not be saved.
    yield* Ref.set(backupFails, true);
    const error = yield* Effect.flip(apps.remove({ projectId }));
    assert.strictEqual(error.message, "Could not dump.");
    assert.deepStrictEqual(yield* Ref.get(removal), []);
    yield* Ref.set(backupFails, false);

    // A running deployment is stopped or deleted first.
    yield* Ref.set(deployedState, "running");
    const deployed = yield* Effect.flip(apps.remove({ projectId }));
    assert.include(deployed.message, "Stop it or delete the deployment under Deploy first");
    assert.deepStrictEqual(yield* Ref.get(removal), []);
    yield* Ref.set(deployedState, "none");

    const removed = yield* apps.remove({ projectId });
    assert.deepStrictEqual(yield* Ref.get(removal), [
      "snapshot, then remove containers and volumes",
      "forget the app",
      "delete the project and its threads",
    ]);
    assert.deepStrictEqual(removed, { snapshot: lastSnapshot, workspaceRoot: habitsRoot });
    assert.deepStrictEqual(
      (yield* apps.list).deleted.map((app) => [app.slug, app.name, app.deletedAt === null]),
      [["habits-a1b2c3", "Habits", false]],
    );

    // Back under its own slug, with its data loaded before it first starts.
    yield* Ref.set(removal, []);
    const restored = yield* apps.restore({ slug: "habits-a1b2c3" });
    yield* Queue.take(harness.started);
    assert.deepStrictEqual(yield* Ref.get(removal), [
      "make a project for its folder",
      "load its last snapshot",
      "start it",
    ]);
    assert.include(restored.app, { slug: "habits-a1b2c3", port: 41_000, name: "Habits" });
    assert.notStrictEqual(restored.app.projectId, projectId);
    assert.deepStrictEqual(yield* Ref.get(harness.registered), [restored.app]);
    assert.deepStrictEqual((yield* apps.list).deleted, []);
    yield* Effect.flip(apps.restore({ slug: "habits-a1b2c3" }));

    // An app deleted before Ozone kept a record is pieced together from what it left, and gets
    // another port when its own is taken.
    const oldRoot = path.join(root, "old-app");
    yield* fs.makeDirectory(oldRoot);
    yield* fs.writeFileString(
      path.join(oldRoot, "ozone.json"),
      JSON.stringify({
        version: 1,
        template: "api-service",
        runtime: {
          kind: "compose",
          file: "compose.yaml",
          appService: "app",
          appPort: 3000,
          healthPath: "/health",
        },
        gates: [],
        data: { services: [] },
      }),
    );
    yield* fs.writeFileString(path.join(oldRoot, ".env"), "OZONE_APP_PORT=41000\nOZONE_UID=501\n");
    const snapshotFolder = path.join(harness.backups, "old-app-9f8e7d", "20251224T000000000Z-aaaa");
    yield* fs.makeDirectory(snapshotFolder, { recursive: true });
    yield* fs.writeFileString(
      path.join(snapshotFolder, "snapshot.json"),
      JSON.stringify({ snapshot: { ...lastSnapshot, projectId: "old-project" }, files: [] }),
    );
    assert.deepStrictEqual((yield* apps.list).deleted, [
      {
        slug: "old-app-9f8e7d",
        name: "Old app",
        templateId: "api-service",
        workspaceRoot: oldRoot,
        deletedAt: "2025-12-24T00:00:00.000Z",
      },
    ]);
    const old = yield* apps.restore({ slug: "old-app-9f8e7d" });
    // 41000 is the restored Habits' now, and another program holds 41001.
    assert.strictEqual(old.app.port, 41_002);
    assert.strictEqual(
      yield* fs.readFileString(path.join(oldRoot, ".env")),
      "OZONE_APP_PORT=41002\nOZONE_UID=501\n",
    );
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);
