import type { OzoneAppError, OzoneGate, OzoneGateResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { ResolvedApp } from "../apps/AppRegistry.ts";
import { findDestructiveStatements } from "../data/migrationGuard.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as BuildRepo from "./BuildRepo.ts";

export interface TaskGateOutcome {
  readonly results: ReadonlyArray<OzoneGateResult>;
  /** Set when a new migration can lose data: a person decides, not another attempt. */
  readonly needsDecision: string | null;
}

/**
 * The checks the server runs itself, inside the app's container. A worker's word that its work
 * passes is never used.
 */
export class BuildGates extends Context.Service<
  BuildGates,
  {
    /** After a task: migrations, the manifest's `task` gates, and that the app still answers. */
    readonly task: (
      app: ResolvedApp,
      input: { readonly baseSha: string | null },
    ) => Effect.Effect<TaskGateOutcome, OzoneAppError>;
    /** Once, when every task has passed: the manifest's `final` gates. */
    readonly final: (
      app: ResolvedApp,
    ) => Effect.Effect<ReadonlyArray<OzoneGateResult>, OzoneAppError>;
  }
>()("t3/ozone/builds/BuildGates") {}

const GATE_TIMEOUT = Duration.minutes(10);
const DETAIL_CHARS = 1_500;

const tail = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length <= DETAIL_CHARS ? trimmed : trimmed.slice(trimmed.length - DETAIL_CHARS);
};

const make = Effect.gen(function* () {
  const runtime = yield* AppRuntime.AppRuntime;
  const repo = yield* BuildRepo.BuildRepo;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const command = Effect.fn("BuildGates.command")(function* (
    app: ResolvedApp,
    id: string,
    shell: string,
  ) {
    const output = yield* runtime.exec({
      projectId: app.app.projectId,
      command: shell,
      timeout: GATE_TIMEOUT,
    });
    const ok = output.code === 0 && !output.timedOut;
    return {
      id,
      ok,
      detail: ok ? "" : output.timedOut ? "It did not finish in ten minutes." : tail(output.output),
    } satisfies OzoneGateResult;
  });

  const manifestGates = (app: ResolvedApp, when: OzoneGate["when"]) =>
    Effect.forEach(
      app.manifest.gates.filter((gate) => gate.when === when),
      (gate) => command(app, gate.id, gate.command),
    );

  /** New migration files since the task began, checked before anything applies them. */
  const destructiveMigrations = Effect.fn("BuildGates.destructiveMigrations")(function* (
    app: ResolvedApp,
    baseSha: string | null,
  ) {
    const migrations = app.manifest.migrations;
    if (migrations === undefined || baseSha === null) return [];
    yield* repo.stageAll(app.workspaceRoot);
    const added = yield* repo.addedSince(app.workspaceRoot, baseSha, migrations.directory);
    const found = yield* Effect.forEach(
      added.filter((file) => file.endsWith(".sql")),
      (file) =>
        fs.readFileString(path.join(app.workspaceRoot, file)).pipe(
          Effect.map((sql) => findDestructiveStatements(file, sql)),
          Effect.orElseSucceed(() => []),
        ),
    );
    return found.flat();
  });

  return BuildGates.of({
    task: Effect.fn("BuildGates.task")(function* (app, input) {
      const status = yield* runtime.status(app.app.projectId);
      if (status.phase !== "running") {
        return {
          results: [
            {
              id: "running",
              ok: false,
              detail:
                `The app is ${status.phase}, so nothing could be checked. ${status.message ?? ""}`.trim(),
            },
          ],
          needsDecision: null,
        };
      }
      const destructive = yield* destructiveMigrations(app, input.baseSha);
      if (destructive.length > 0) {
        const listed = destructive
          .map((found) => `${found.file}:${found.line} ${found.effect}: ${found.statement}`)
          .join("\n");
        return {
          results: [{ id: "migrations", ok: false, detail: listed }],
          needsDecision: `A new migration can lose data.\n${listed}`,
        };
      }
      const migrated =
        app.manifest.migrations === undefined
          ? []
          : [yield* command(app, "migrate", app.manifest.migrations.apply)];
      const checks = yield* manifestGates(app, "task");
      const answers = yield* command(
        app,
        "responds",
        `node --eval "fetch('http://127.0.0.1:${app.manifest.runtime.appPort}/').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"`,
      );
      return { results: [...migrated, ...checks, answers], needsDecision: null };
    }),
    final: Effect.fn("BuildGates.final")((app) => manifestGates(app, "final")),
  });
});

export const layer = Layer.effect(BuildGates, make);
