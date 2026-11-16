import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { TEST_DATABASE, TEST_MIGRATIONS, testApp, testManifest } from "../ozone.testkit.ts";
import * as AppRegistry from "./AppRegistry.ts";

const app = (id: string, port: number, createdAt: string) =>
  testApp({ projectId: ProjectId.make(id), slug: `${id}-slug`, name: id, port, createdAt });

const manifest = testManifest({
  template: "web-app",
  gates: [{ id: "typecheck", command: "npm run typecheck", when: "task" }],
  data: { services: [{ ...TEST_DATABASE, database: "app", user: "app" }] },
  migrations: TEST_MIGRATIONS,
});

it.effect("AppRegistry records apps and resolves each one's folder and manifest", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-registry-" });
    const folders = new Map([
      ["habits", path.join(root, "habits")],
      ["broken", path.join(root, "broken")],
      ["bare", path.join(root, "bare")],
    ]);
    for (const folder of folders.values()) yield* fs.makeDirectory(folder);
    yield* fs.writeFileString(path.join(root, "habits", "ozone.json"), JSON.stringify(manifest));
    yield* fs.writeFileString(path.join(root, "broken", "ozone.json"), '{"version":2}');

    const registry = yield* AppRegistry.make.pipe(
      Effect.provide(
        Layer.mock(ProjectService.ProjectService)({
          getById: (projectId) =>
            Effect.succeed(
              Option.map(Option.fromNullishOr(folders.get(projectId)), (workspaceRoot) => ({
                id: projectId,
                title: projectId,
                workspaceRoot,
                defaultModelSelection: null,
                scripts: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                deletedAt: null,
              })),
            ),
        }),
      ),
    );

    const habits = app("habits", 41_000, "2026-01-01T00:00:00.000Z");
    const broken = app("broken", 41_001, "2026-01-02T00:00:00.000Z");
    yield* registry.register(habits);
    yield* registry.register(broken);
    yield* registry.register(app("bare", 41_002, "2026-01-03T00:00:00.000Z"));
    yield* registry.register(app("moved-away", 41_003, "2026-01-04T00:00:00.000Z"));

    assert.deepStrictEqual(
      (yield* registry.list).map((entry) => entry.projectId),
      ["moved-away", "bare", "broken", "habits"],
    );
    assert.deepStrictEqual(yield* registry.resolve(habits.projectId), {
      app: { ...habits, firstStartedAt: null },
      workspaceRoot: path.join(root, "habits"),
      manifest,
    });

    const reasonFor = (id: string) =>
      registry.resolve(ProjectId.make(id)).pipe(
        Effect.flip,
        Effect.map((error) => error.reason),
      );
    assert.strictEqual(yield* reasonFor("broken"), "invalid_manifest");
    assert.strictEqual(yield* reasonFor("bare"), "invalid_manifest");
    // Registered once, but upstream no longer has the project.
    assert.strictEqual(yield* reasonFor("moved-away"), "not_an_app");
    assert.strictEqual(yield* reasonFor("never-registered"), "not_an_app");

    // The first healthy start is recorded once and kept.
    yield* registry.markStarted(habits.projectId, "2026-03-01T00:00:00.000Z");
    yield* registry.markStarted(habits.projectId, "2026-04-01T00:00:00.000Z");
    assert.strictEqual(
      (yield* registry.resolve(habits.projectId)).app.firstStartedAt,
      "2026-03-01T00:00:00.000Z",
    );

    // The port is the app's for life: a second app cannot be given it.
    const duplicate = yield* Effect.flip(
      registry.register(app("other", 41_000, "2026-02-01T00:00:00.000Z")),
    );
    assert.strictEqual(duplicate.reason, "failed");
  }).pipe(Effect.provide(Layer.merge(SqlitePersistence.layerMemory, NodeServices.layer))),
);
