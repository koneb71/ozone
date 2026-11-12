import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  ProjectId,
  type OzoneAppManifest,
  type OzoneRuntimePhase,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as AppEnv from "./AppEnv.ts";
import { envFilePath } from "./envFile.ts";

const projectId = ProjectId.make("project-notes");
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

const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-env-" });
  const phase = yield* Ref.make<OzoneRuntimePhase>("running");
  const actions = yield* Ref.make<ReadonlyArray<string>>([]);
  const status = Effect.map(Ref.get(phase), (current) => ({
    projectId,
    phase: current,
    url: null,
    services: [],
    message: null,
    migration: null,
    updatedAt: AT,
  }));
  const { env, config } = yield* Effect.all({
    env: AppEnv.AppEnv,
    config: ServerConfig.ServerConfig,
  }).pipe(
    Effect.provide(
      AppEnv.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-env-home-" })),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(AppRegistry.AppRegistry)({
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
                  workspaceRoot: path.join(root, "notes"),
                  manifest,
                }),
            }),
            Layer.mock(AppRuntime.AppRuntime)({
              status: () => status,
              apply: () =>
                Ref.update(actions, (all) => [...all, "apply"]).pipe(Effect.andThen(status)),
            }),
          ),
        ),
      ),
    ),
  );
  return { env, fs, phase, actions, file: envFilePath(path, config.stateDir, "notes-a1b2c3") };
});

it.effect("keeps a secret's value from every reader, and restarts only a running app", () =>
  Effect.gen(function* () {
    const { env, fs, phase, actions, file } = yield* makeHarness;
    yield* env.set({ projectId, name: "PLAN", value: "pro", secret: false });
    const listed = yield* env.set({ projectId, name: "API_KEY", value: "sk-123", secret: true });
    assert.deepStrictEqual(listed.variables, [
      { name: "API_KEY", secret: true, value: null },
      { name: "PLAN", secret: false, value: "pro" },
    ]);
    assert.deepStrictEqual(yield* env.list(projectId), listed);
    // Only the server can read the file that holds the value.
    assert.strictEqual(((yield* fs.stat(file)).mode & 0o777).toString(8), "600");
    assert.include(yield* fs.readFileString(file), "sk-123");
    // The running app was recreated so it reads them.
    assert.deepStrictEqual(yield* Ref.get(actions), ["apply", "apply"]);

    yield* Ref.set(phase, "stopped");
    const removed = yield* env.remove({ projectId, name: "PLAN" });
    assert.deepStrictEqual(
      removed.variables.map((variable) => variable.name),
      ["API_KEY"],
    );
    // A stopped app reads the change when it starts; it is not started for it.
    assert.deepStrictEqual(yield* Ref.get(actions), ["apply", "apply"]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
