import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OzoneAppManifest, ProjectId, type OzoneApp } from "@t3tools/contracts";
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
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { OZONE_APP_INSTRUCTIONS } from "./appInstructions.ts";
import * as AppRegistry from "./AppRegistry.ts";
import * as OzoneApps from "./OzoneApps.ts";

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(OzoneAppManifest));

const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-apps-" });
  const registered = yield* Ref.make<ReadonlyArray<OzoneApp>>([]);
  const created = yield* Ref.make(0);
  const commits = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
  const started = yield* Queue.unbounded<ProjectId>();

  const apps = yield* OzoneApps.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(AppRegistry.AppRegistry)({
          list: Ref.get(registered),
          register: (app) => Ref.update(registered, (all) => [...all, app]),
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
  return { apps, root, registered, created, commits, started, fs, path };
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
