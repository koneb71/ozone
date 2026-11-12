import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_OZONE_APP_SETTINGS, ProjectId, type OzoneAppManifest } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { ResolvedApp } from "../apps/AppRegistry.ts";
import { acceptToken, parseHeldBack } from "../data/migrationGuard.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as BuildGates from "./BuildGates.ts";
import * as BuildRepo from "./BuildRepo.ts";

const { excerpt } = BuildGates;

// A bundler prints its error first and a stack after it; a test runner ends with its summary.
it("keeps both ends of a long check output", () => {
  const output = [
    "error: Could not resolve ./missing from src/routes/index.tsx",
    ...Array.from({ length: 400 }, (_, index) => `    at frame ${index} (node_modules/x.js:1:1)`),
    "Build failed in 2.1s",
  ].join("\n");

  const kept = excerpt(output);

  assert.isBelow(kept.length, 2_100);
  assert.match(kept, /^error: Could not resolve \.\/missing/);
  assert.match(kept, /Build failed in 2\.1s$/);
  assert.strictEqual(excerpt("  short\n"), "short");
});

const projectId = ProjectId.make("project-notes");
const manifest: OzoneAppManifest = {
  version: 1,
  runtime: {
    kind: "compose",
    file: "compose.yaml",
    appService: "app",
    appPort: 3000,
    healthPath: "/api/health",
  },
  gates: [{ id: "typecheck", command: "npm run typecheck", when: "task" }],
  data: { services: [] },
  migrations: {
    directory: "drizzle",
    generate: "npm run db:generate",
    apply: "npm run db:migrate",
  },
};
const DROP = 'DROP TABLE "notes";';

/** The gates over a real workspace whose task added `added`, and a migrate command that prints `migrate`. */
const makeGates = (options: { readonly added: ReadonlyArray<string>; readonly migrate?: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-gates-" });
    yield* fs.makeDirectory(path.join(workspaceRoot, "drizzle"));
    yield* fs.writeFileString(path.join(workspaceRoot, "drizzle", "0001_drop.sql"), DROP);
    const commands = yield* Ref.make<ReadonlyArray<string>>([]);
    const context = yield* Layer.build(
      BuildGates.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(AppRuntime.AppRuntime)({
              changes: () =>
                Stream.make({
                  projectId,
                  phase: "running" as const,
                  url: "http://localhost:41000",
                  services: [],
                  message: null,
                  migration: null,
                  updatedAt: "2026-01-01T00:00:00.000Z",
                }),
              exec: (input) =>
                Ref.update(commands, (all) => [...all, input.command]).pipe(
                  Effect.as(
                    input.command === "npm run db:migrate" && options.migrate !== undefined
                      ? { code: 3, output: options.migrate, timedOut: false }
                      : { code: 0, output: "", timedOut: false },
                  ),
                ),
            }),
            Layer.mock(BuildRepo.BuildRepo)({
              stageAll: () => Effect.void,
              addedSince: () => Effect.succeed(options.added),
            }),
          ),
        ),
      ),
    );
    const app: ResolvedApp = {
      app: {
        projectId,
        slug: "notes-a1b2c3",
        name: "Notes",
        templateId: "web-app",
        port: 41_000,
        createdAt: "2026-01-01T00:00:00.000Z",
        settings: DEFAULT_OZONE_APP_SETTINGS,
      },
      workspaceRoot,
      manifest,
    };
    const outcome = yield* Context.get(context, BuildGates.BuildGates).task(app, {
      baseSha: "base",
    });
    const report = yield* fs
      .readFileString(path.join(workspaceRoot, ".ozone", "migrations.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    return { outcome, commands: yield* Ref.get(commands), report };
  });

const tokensOf = (outcome: BuildGates.TaskGateOutcome) =>
  parseHeldBack(outcome.results.find((result) => result.id === "migrations")?.detail ?? "")?.accept;

// The person decides; their acceptance runs exactly the SQL they were shown.
it.effect("stops for a person on a migration that can lose data, whoever would apply it", () =>
  Effect.gen(function* () {
    const added = yield* makeGates({ added: ["drizzle/0001_drop.sql"] });
    assert.include(added.outcome.needsDecision ?? "", "A new migration can lose data.");
    assert.include(added.outcome.needsDecision ?? "", "drops a table");
    assert.deepStrictEqual(tokensOf(added.outcome), [acceptToken("0001_drop.sql", DROP)]);
    // Checked before anything applies it, and shown in the app's banner for the user.
    assert.deepStrictEqual(added.commands, []);
    assert.include(added.report, acceptToken("0001_drop.sql", DROP));

    // One already waiting is held back by the app's own migrate command.
    const waiting = yield* makeGates({
      added: [],
      migrate: [
        "Ozone held back a migration that can lose data.",
        '0001_drop.sql:1 drops a table: DROP TABLE "notes"',
        "ozone-accept 0001_drop.sql@abc",
      ].join("\n"),
    });
    assert.include(
      waiting.outcome.needsDecision ?? "",
      "A migration waiting to run can lose data.",
    );
    assert.deepStrictEqual(tokensOf(waiting.outcome), ["0001_drop.sql@abc"]);
    assert.deepStrictEqual(waiting.commands, ["npm run db:migrate"]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
