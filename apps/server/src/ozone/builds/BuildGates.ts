import type { OzoneAppError, OzoneGate, OzoneGateResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { ResolvedApp } from "../apps/AppRegistry.ts";
import {
  acceptToken,
  describeStatement,
  findDestructiveStatements,
  encodeMigrationReport,
  formatHeldBack,
  MIGRATION_REPORT_FILE,
  parseHeldBack,
  type MigrationReport,
} from "../data/migrationGuard.ts";
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
const START_TIMEOUT = Duration.minutes(3);
const DETAIL_CHARS = 2_000;

/** A bundler prints its error first and a stack after it; a test runner ends with its summary. */
export const excerpt = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length <= DETAIL_CHARS) return trimmed;
  const half = DETAIL_CHARS / 2;
  return `${trimmed.slice(0, half)}\n[...]\n${trimmed.slice(trimmed.length - half)}`;
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
      detail: ok
        ? ""
        : output.timedOut
          ? "It did not finish in ten minutes."
          : excerpt(output.output) || `It exited with code ${output.code} and printed nothing.`,
    } satisfies OzoneGateResult;
  });

  const manifestGates = (app: ResolvedApp, when: OzoneGate["when"]) =>
    Effect.forEach(
      app.manifest.gates.filter((gate) => gate.when === when),
      (gate) => command(app, gate.id, gate.command),
    );

  /** New migration files since the task began that can lose data, or null when there are none. */
  const destructiveMigrations = Effect.fn("BuildGates.destructiveMigrations")(function* (
    app: ResolvedApp,
    baseSha: string | null,
  ) {
    const migrations = app.manifest.migrations;
    if (migrations === undefined || baseSha === null) return null;
    yield* repo.stageAll(app.workspaceRoot);
    const added = yield* repo.addedSince(app.workspaceRoot, baseSha, migrations.directory);
    const found = yield* Effect.forEach(
      added.filter((file) => file.endsWith(".sql")),
      (file) =>
        fs.readFileString(path.join(app.workspaceRoot, file)).pipe(
          Effect.map((sql) => {
            const statements = findDestructiveStatements(file, sql);
            return statements.length === 0
              ? []
              : [{ statements, token: acceptToken(path.basename(file), sql) }];
          }),
          Effect.orElseSucceed(() => []),
        ),
    );
    const held = found.flat();
    if (held.length === 0) return null;
    return {
      statements: held.flatMap((entry) => entry.statements.map(describeStatement)),
      accept: held.map((entry) => entry.token),
    } satisfies MigrationReport;
  });

  /**
   * A decision only the person can make: the app's banner shows the report until they apply the
   * migration there, after a snapshot. The evidence keeps the tokens.
   */
  const heldBackOutcome = Effect.fn("BuildGates.heldBackOutcome")(function* (
    app: ResolvedApp,
    headline: string,
    report: MigrationReport,
  ) {
    const reportPath = path.join(app.workspaceRoot, ...MIGRATION_REPORT_FILE.split("/"));
    yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true }).pipe(
      Effect.andThen(encodeMigrationReport(report)),
      Effect.flatMap((json) => fs.writeFileString(reportPath, `${json}\n`)),
      Effect.ignore,
    );
    return {
      results: [{ id: "migrations", ok: false, detail: formatHeldBack(report) }],
      needsDecision: `${headline} It runs only when the user applies it from the app's banner in Ozone, which takes a snapshot first. Tell them what it does, and accept this task once they have applied it.\n${report.statements.join("\n")}`,
    } satisfies TaskGateOutcome;
  });

  return BuildGates.of({
    task: Effect.fn("BuildGates.task")(function* (app, input) {
      // An app that is still starting, after a restart of its own or of the server, is waited for.
      const settled = yield* runtime.changes(app.app.projectId).pipe(
        Stream.filter((status) => status.phase !== "starting"),
        Stream.runHead,
        Effect.timeoutOption(START_TIMEOUT),
        Effect.map(Option.flatten),
      );
      const status = Option.getOrNull(settled);
      if (status?.phase !== "running") {
        const why =
          status === null
            ? "The app did not finish starting in three minutes, so nothing could be checked."
            : `The app is ${status.phase}, so nothing could be checked. ${status.message ?? ""}`;
        return {
          results: [{ id: "running", ok: false, detail: why.trim() }],
          needsDecision: null,
        };
      }
      const added = yield* destructiveMigrations(app, input.baseSha);
      if (added !== null)
        return yield* heldBackOutcome(app, "A new migration can lose data.", added);
      const migrated =
        app.manifest.migrations === undefined
          ? []
          : [yield* command(app, "migrate", app.manifest.migrations.apply)];
      // The app's own migrate command also holds back one that was already waiting.
      const waiting = migrated[0]?.ok === false ? parseHeldBack(migrated[0].detail) : null;
      if (waiting !== null) {
        return yield* heldBackOutcome(app, "A migration waiting to run can lose data.", waiting);
      }
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
