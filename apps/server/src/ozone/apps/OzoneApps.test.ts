import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  OzoneAppError,
  OzoneAppManifest,
  ProjectId,
  type OzoneApp,
  type OzoneSnapshot,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppData from "../data/AppData.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
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
  const record = (step: string) => Ref.update(removal, (all) => [...all, step]);

  const apps = yield* OzoneApps.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(AppRegistry.AppRegistry)({
          list: Ref.get(registered),
          register: (app) => Ref.update(registered, (all) => [...all, app]),
          resolve: (projectId) =>
            Effect.succeed({
              app: { ...lastSnapshot, projectId } as never,
              workspaceRoot: path.join(root, "habits"),
              manifest: {} as never,
            }),
          unregister: () => record("forget the app"),
        }),
        Layer.mock(AppData.AppData)({
          remove: Effect.fn("TestData.remove")(function* () {
            if (yield* Ref.get(backupFails)) {
              return yield* new OzoneAppError({ reason: "failed", message: "Could not dump." });
            }
            yield* record("snapshot, then remove containers and volumes");
            return { snapshot: lastSnapshot };
          }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          delete: (input) =>
            record(`delete the project${input.force === true ? " and its threads" : ""}`).pipe(
              Effect.as({} as never),
            ),
        }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: root,
          createNamedProject: Effect.fn("TestFolders.createNamedProject")(function* (input) {
            const index = yield* Ref.updateAndGet(created, (count) => count + 1);
            const workspaceRoot = path.join(root, input.name.toLowerCase().replaceAll(" ", "-"));
            yield* fs.makeDirectory(workspaceRoot).pipe(Effect.orDie);
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
          act: (input) => Queue.offer(started, input.projectId).pipe(Effect.andThen(Effect.never)),
        }),
      ),
    ),
  );
  return { apps, root, registered, created, commits, started, fs, path, removal, backupFails };
});

it.effect("OzoneApps creates an app from the template, registers it and starts it", () =>
  Effect.gen(function* () {
    const { apps, root, registered, commits, started, fs, path } = yield* makeHarness;

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
      },
    );
    assert.deepStrictEqual(yield* Ref.get(registered), [first.app]);
    assert.strictEqual(yield* Queue.take(started), first.app.projectId);
    assert.deepStrictEqual(
      (yield* Ref.get(commits)).map((args) =>
        args.find((arg) => arg === "add" || arg === "commit"),
      ),
      ["add", "commit"],
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
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("OzoneApps refuses an unknown template before creating anything", () =>
  Effect.gen(function* () {
    const { apps, created } = yield* makeHarness;
    const error = yield* Effect.flip(apps.create({ name: "Habits", templateId: "mobile-app" }));
    assert.strictEqual(error.reason, "unknown_template");
    assert.strictEqual(yield* Ref.get(created), 0);
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("OzoneApps deletes an app's data behind a snapshot, then forgets the app", () =>
  Effect.gen(function* () {
    const { apps, removal, backupFails, root, path } = yield* makeHarness;
    const projectId = ProjectId.make("a1b2c3-project-1");

    // Nothing is forgotten while the data could not be saved.
    yield* Ref.set(backupFails, true);
    const error = yield* Effect.flip(apps.remove({ projectId }));
    assert.strictEqual(error.message, "Could not dump.");
    assert.deepStrictEqual(yield* Ref.get(removal), []);

    yield* Ref.set(backupFails, false);
    const removed = yield* apps.remove({ projectId });
    assert.deepStrictEqual(yield* Ref.get(removal), [
      "snapshot, then remove containers and volumes",
      "forget the app",
      "delete the project and its threads",
    ]);
    assert.deepStrictEqual(removed, {
      snapshot: lastSnapshot,
      workspaceRoot: path.join(root, "habits"),
    });
  }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);
