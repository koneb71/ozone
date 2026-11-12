import {
  OzoneAppError,
  OzoneDeployTarget,
  type OzoneDataRestoreInput,
  type OzoneDataRestoreResult,
  type OzoneDataSnapshotInput,
  type OzoneDeployRunInput,
  type OzoneDeployStatus,
  type OzoneSnapshot,
  type ProjectId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ServerConfig from "../../config.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildRepo from "../builds/BuildRepo.ts";
import * as AppData from "../data/AppData.ts";
import {
  ACCEPT_MIGRATIONS_ENV,
  parseHeldBack,
  type MigrationReport,
} from "../data/migrationGuard.ts";
import { composeValue, ENV_FILE_MODE, envFilePath, readEnvFile } from "../env/envFile.ts";
import * as DockerCli from "../runtime/DockerCli.ts";
import { hostCaPath } from "../runtime/hostCa.ts";

/**
 * Runs an app's production image where people can reach it: on this machine, or on a Docker host
 * over SSH. It is a Compose project of its own, with a database of its own, so development data
 * is never touched and nothing here removes a volume.
 */
export class AppDeploy extends Context.Service<
  AppDeploy,
  {
    readonly status: (projectId: ProjectId) => Effect.Effect<OzoneDeployStatus, OzoneAppError>;
    /** Builds, migrates and starts. Once started it runs to its end, whoever was waiting. */
    readonly deploy: (
      input: OzoneDeployRunInput,
    ) => Effect.Effect<OzoneDeployStatus, OzoneAppError>;
    /** Stops the production containers. Their data stays for the next deploy. */
    readonly stop: (projectId: ProjectId) => Effect.Effect<OzoneDeployStatus, OzoneAppError>;
    /** Production's snapshots, kept apart from development's. */
    readonly snapshots: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<OzoneSnapshot>, OzoneAppError>;
    readonly snapshot: (
      input: OzoneDataSnapshotInput,
    ) => Effect.Effect<OzoneSnapshot, OzoneAppError>;
    /**
     * Replaces production's data with a snapshot, after one of the data as it is, then applies the
     * deployed version's migrations and starts it again. Runs to its end, whoever was waiting.
     */
    readonly restore: (
      input: OzoneDataRestoreInput,
    ) => Effect.Effect<OzoneDataRestoreResult, OzoneAppError>;
  }
>()("t3/ozone/deploy/AppDeploy") {}

export const PROD_COMPOSE_FILE = "compose.prod.yaml";
/** Production listens beside development: an app on 41005 is on 42005 in production. */
const PROD_PORT_OFFSET = 1_000;
const BUILD_TIMEOUT = Duration.minutes(20);
const STEP_TIMEOUT = Duration.minutes(5);
const OUTPUT_TAIL = 1_500;

const DeployRecord = Schema.Struct({
  target: OzoneDeployTarget,
  url: Schema.String,
  commitSha: Schema.NullOr(Schema.String),
  deployedAt: Schema.String,
});
type DeployRecord = typeof DeployRecord.Type;
const DeployFile = Schema.fromJsonString(
  Schema.Struct({
    secrets: Schema.Struct({ authSecret: Schema.String, dbPassword: Schema.String }),
    last: Schema.NullOr(DeployRecord),
    /** Where the app was deployed before, one record per place. Their volumes are still there. */
    previous: Schema.Array(DeployRecord).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  }),
);
type DeployFile = typeof DeployFile.Type;
const decodeDeployFile = Schema.decodeUnknownEffect(DeployFile);
const encodeDeployFile = Schema.encodeEffect(DeployFile);

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });
const NOT_DEPLOYED: OzoneDeployStatus = {
  state: "none",
  target: null,
  url: null,
  commitSha: null,
  deployedAt: null,
  message: null,
  migration: null,
};

interface ProdDatabase {
  readonly service: string;
  readonly user: string;
  readonly database: string;
  readonly password: string;
}

/**
 * What Ozone adds to `compose.prod.yaml`: the secrets it generated, the app's own variables, and
 * the host's certificate bundle for the image build. Values are escaped as in development.
 */
const prodOverride = (input: {
  readonly appService: string;
  readonly database: ProdDatabase | null;
  readonly migrate: boolean;
  readonly authSecret: string;
  readonly publicUrl: string;
  readonly variables: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly hostCaPath: string | null;
}): string => {
  const { database } = input;
  const databaseUrl =
    database === null
      ? null
      : `postgres://${database.user}:${encodeURIComponent(database.password)}@${database.service}:5432/${database.database}`;
  const appEnvironment = new Map<string, string>([
    ["BETTER_AUTH_SECRET", input.authSecret],
    ["BETTER_AUTH_URL", input.publicUrl],
    ...(databaseUrl === null ? [] : [["DATABASE_URL", databaseUrl] as const]),
  ]);
  for (const variable of input.variables) appEnvironment.set(variable.name, variable.value);
  const environment = (values: ReadonlyMap<string, string>) => [
    "    environment:",
    ...[...values].map(([name, value]) => `      ${name}: ${composeValue(value)}`),
  ];
  const buildSecret =
    input.hostCaPath === null ? [] : ["    build:", "      secrets:", "        - host_ca"];
  return [
    "services:",
    `  ${JSON.stringify(input.appService)}:`,
    ...environment(appEnvironment),
    ...buildSecret,
    ...(database === null || databaseUrl === null
      ? []
      : [
          ...(input.migrate
            ? [
                "  migrate:",
                ...environment(new Map([["DATABASE_URL", databaseUrl]])),
                ...buildSecret,
              ]
            : []),
          `  ${JSON.stringify(database.service)}:`,
          ...environment(new Map([["POSTGRES_PASSWORD", database.password]])),
        ]),
    ...(input.hostCaPath === null
      ? []
      : ["secrets:", "  host_ca:", `    file: ${composeValue(input.hostCaPath)}`]),
    "",
  ].join("\n");
};

/** The host without its user and port: `deploy@example.com:2222` is reached at `example.com`. */
const hostName = (host: string) => host.replace(/^[^@]*@/, "").replace(/:\d+$/, "");

const make = Effect.gen(function* () {
  const docker = yield* DockerCli.DockerCli;
  const registry = yield* AppRegistry.AppRegistry;
  const repo = yield* BuildRepo.BuildRepo;
  const data = yield* AppData.AppData;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const random = yield* SecureRandom.SecureRandom;
  const hostEnvironment = yield* HostProcess.Environment;
  const scope = yield* Scope.Scope;
  /** What a deploy in flight is doing, by app. */
  const inFlight = new Map<ProjectId, string>();
  /** Why the last deploy failed, until the next one starts. */
  const failures = new Map<ProjectId, string>();
  /** What the last deploy's migrate step held back, until a deploy runs it. */
  const heldBack = new Map<ProjectId, MigrationReport>();

  const directoryOf = (app: ResolvedApp) =>
    path.join(config.stateDir, "ozone", "apps", app.app.slug);
  const fileOf = (app: ResolvedApp) => path.join(directoryOf(app), "deploy.json");
  const portOf = (app: ResolvedApp) => app.app.port + PROD_PORT_OFFSET;
  const urlOf = (app: ResolvedApp, target: OzoneDeployTarget) =>
    target.publicUrl ??
    `http://${target.host === null ? "localhost" : hostName(target.host)}:${portOf(app)}`;

  /**
   * The saved settings, or null before the first deploy. A file that exists but cannot be read
   * stops everything: it holds the password the production database was created with.
   */
  const readRecord = (app: ResolvedApp) =>
    fs.readFileString(fileOf(app)).pipe(
      Effect.map((json): string | null => json),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
      Effect.flatMap((json) => (json === null ? Effect.succeed(null) : decodeDeployFile(json))),
      Effect.mapError(() =>
        failed(
          `Ozone could not read ${fileOf(app)}, which holds the production database's password. Restore that file before deploying again.`,
        ),
      ),
    );
  const writeRecord = Effect.fn("AppDeploy.writeRecord")(
    function* (app: ResolvedApp, file: DeployFile) {
      const json = yield* encodeDeployFile(file);
      const temporary = `${fileOf(app)}.tmp`;
      yield* fs.makeDirectory(directoryOf(app), { recursive: true });
      // Written whole and then renamed, so a crash never leaves half a password file.
      yield* fs.writeFileString(temporary, json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(temporary, ENV_FILE_MODE);
      yield* fs.rename(temporary, fileOf(app));
    },
    Effect.mapError(() => failed("Ozone could not save the deploy's settings.")),
  );
  const newSecret = Effect.map(Effect.all([random.uuidV4(), random.uuidV4()]), (parts) =>
    parts.join("").replaceAll("-", ""),
  );

  /** `docker [-H ssh://host] compose` for the app's production project, from the files in `root`. */
  const composeArgs = (app: ResolvedApp, target: OzoneDeployTarget, root = app.workspaceRoot) => [
    ...(target.host === null ? [] : ["-H", `ssh://${target.host}`]),
    "compose",
    "--project-name",
    `${app.app.slug}-prod`,
    "--project-directory",
    root,
    "-f",
    path.join(root, PROD_COMPOSE_FILE),
  ];

  const statusOf = Effect.fn("AppDeploy.statusOf")(
    function* (app: ResolvedApp) {
      const projectId = app.app.projectId;
      const record = yield* readRecord(app);
      const last = record?.last ?? null;
      const doing = inFlight.get(projectId);
      const failure = failures.get(projectId) ?? null;
      const base = {
        target: last?.target ?? null,
        url: last?.url ?? null,
        commitSha: last?.commitSha ?? null,
        deployedAt: last?.deployedAt ?? null,
        migration: heldBack.get(projectId)?.statements.join("\n") ?? null,
      };
      if (doing !== undefined) return { ...base, state: "deploying" as const, message: doing };
      if (failure !== null) return { ...base, state: "failed" as const, message: failure };
      if (last === null) return { ...NOT_DEPLOYED, migration: base.migration };
      const ps = yield* docker
        .run({
          args: [
            ...composeArgs(app, last.target),
            "ps",
            "--format",
            "json",
            app.manifest.runtime.appService,
          ],
          cwd: app.workspaceRoot,
          timeout: Duration.seconds(30),
        })
        .pipe(Effect.option);
      const running =
        ps._tag === "Some" &&
        ps.value.stdout.split("\n").some((line) => line.includes('"State":"running"'));
      return {
        ...base,
        state: running ? ("running" as const) : ("stopped" as const),
        message: null,
      };
    },
    Effect.catch((error) =>
      Effect.succeed<OzoneDeployStatus>({
        ...NOT_DEPLOYED,
        state: "failed",
        message: error.message,
      }),
    ),
  );

  const overridePathOf = (app: ResolvedApp) =>
    path.join(directoryOf(app), "compose.prod.override.yaml");
  const appServiceOf = (app: ResolvedApp) => app.manifest.runtime.appService;
  const placeOf = (target: OzoneDeployTarget) =>
    target.host === null ? "this machine" : hostName(target.host);

  /** The files of a commit, in a folder that lasts as long as the scope. */
  const exportCommit = Effect.fn("AppDeploy.exportCommit")(function* (
    app: ResolvedApp,
    commitSha: string,
  ) {
    const scratch = yield* fs
      .makeTempDirectoryScoped({ prefix: "ozone-deploy-" })
      .pipe(Effect.mapError(() => failed("Ozone could not make a folder for the deploy.")));
    const root = yield* repo.exportTree(app.workspaceRoot, commitSha, scratch);
    if (root === null) {
      return yield* failed(`Ozone could not read commit ${commitSha.slice(0, 7)} of the app.`);
    }
    const hasProdFile = yield* fs
      .exists(path.join(root, PROD_COMPOSE_FILE))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasProdFile) {
      return yield* failed(
        `Commit ${commitSha.slice(0, 7)} has no ${PROD_COMPOSE_FILE}. Commit it, then deploy again.`,
      );
    }
    return root;
  });

  /** Docker Compose for the app's production project on `target`, from the files in `root`. */
  const production = Effect.fn("AppDeploy.production")(function* (
    app: ResolvedApp,
    target: OzoneDeployTarget,
    root: string,
  ) {
    // A remote daemon builds with its own network.
    const ca = target.host === null ? yield* hostCaPath(hostEnvironment, fs) : null;
    const args = [...composeArgs(app, target, root), "-f", overridePathOf(app)];
    const env = {
      OZONE_PROD_PORT: String(portOf(app)),
      // On a server it is meant to be reached; here, only from this machine.
      OZONE_PROD_BIND: target.host === null ? "127.0.0.1" : "0.0.0.0",
      // Compose builds through buildx bake, which refuses to read a file outside the project
      // unless allowed, and has no flag for it. The only such file is the bundle Ozone named.
      ...(ca === null ? {} : { BUILDX_BAKE_ENTITLEMENTS_FS: "0" }),
    };
    const compose = (
      command: ReadonlyArray<string>,
      options?: { readonly timeout?: Duration.Input },
    ) =>
      docker
        .run({
          args: [...args, ...command],
          cwd: root,
          env,
          timeout: options?.timeout ?? STEP_TIMEOUT,
          maxOutputBytes: 2 * 1024 * 1024,
        })
        .pipe(Effect.mapError((error) => failed(error.detail)));
    const run = Effect.fn("AppDeploy.run")(function* (
      what: string,
      command: ReadonlyArray<string>,
      timeout: Duration.Duration,
    ) {
      const output = yield* compose(command, { timeout });
      if (output.code === 0 && !output.timedOut) return;
      // Compose prints its progress on one stream and the reason on either.
      const said = `${output.stdout}\n${output.stderr}`.trim().slice(-OUTPUT_TAIL);
      return yield* failed(
        output.timedOut ? `${what}: it did not finish in time.` : `${what}:\n${said}`,
      );
    });
    /** Production's data, wherever it runs, with the commit it belongs with. */
    const dataTarget = (commitSha: string | null): AppData.DataTarget => ({
      projectId: app.app.projectId,
      folder: path.join(app.app.slug, "production"),
      databases: app.manifest.data.services.filter((service) => service.kind === "postgres"),
      compose,
      commitSha: Effect.succeed(commitSha),
    });
    return { ca, compose, run, dataTarget };
  });
  type Production = Effect.Success<ReturnType<typeof production>>;

  /** Runs `use` against a deploy that exists, from the files of the commit it runs. */
  const withDeployed = Effect.fn("AppDeploy.withDeployed")(function* <A>(
    app: ResolvedApp,
    record: DeployRecord,
    use: (prod: Production) => Effect.Effect<A, OzoneAppError>,
  ) {
    if (record.commitSha === null) {
      return yield* failed(
        "Ozone does not know which commit production runs. Deploy the app again first.",
      );
    }
    const root = yield* exportCommit(app, record.commitSha);
    return yield* use(yield* production(app, record.target, root));
  }, Effect.scoped);

  /** The migrate step. One that can lose data is held back unless its tokens were accepted. */
  const migrateStep = Effect.fn("AppDeploy.migrateStep")(function* (
    app: ResolvedApp,
    prod: Production,
    accepted: ReadonlyArray<string>,
    heldBackMeans: string,
  ) {
    const output = yield* prod.compose([
      "run",
      "--rm",
      "-T",
      ...(accepted.length === 0 ? [] : ["-e", `${ACCEPT_MIGRATIONS_ENV}=${accepted.join(" ")}`]),
      "migrate",
    ]);
    const said = `${output.stdout}\n${output.stderr}`.trim();
    const held = output.code === 0 ? null : parseHeldBack(said);
    if (held !== null) {
      heldBack.set(app.app.projectId, held);
      return yield* failed(`${heldBackMeans}\n${held.statements.join("\n")}`);
    }
    if (output.code !== 0 || output.timedOut) {
      return yield* failed(
        output.timedOut
          ? "The migrations could not be applied: they did not finish in time."
          : `The migrations could not be applied:\n${said.slice(-OUTPUT_TAIL)}`,
      );
    }
    heldBack.delete(app.app.projectId);
  });
  const startApp = (app: ResolvedApp, prod: Production) =>
    prod.run(
      "The app did not start",
      ["up", "--detach", "--wait", "--no-deps", appServiceOf(app)],
      STEP_TIMEOUT,
    );
  const migrates = (app: ResolvedApp) =>
    app.manifest.migrations !== undefined &&
    app.manifest.data.services.some((service) => service.kind === "postgres");

  const deployNow = Effect.fn("AppDeploy.deployNow")(function* (
    app: ResolvedApp,
    input: OzoneDeployRunInput,
  ) {
    const projectId = app.app.projectId;
    const target = input.target;
    const step = (doing: string) => Effect.sync(() => inFlight.set(projectId, doing));
    const stored = yield* readRecord(app);
    // Production runs the last commit, never a worker's half-done files or the dev `.env`.
    const commitSha = yield* repo.head(app.workspaceRoot);
    if (commitSha === null) return yield* failed("This app has no commit to deploy yet.");
    const root = yield* exportCommit(app, commitSha);
    const secrets = stored?.secrets ?? {
      authSecret: yield* newSecret,
      dbPassword: yield* newSecret,
    };
    const known = [...(stored?.last == null ? [] : [stored.last]), ...(stored?.previous ?? [])];
    // Kept before anything runs: a database is created with its first password and keeps it.
    yield* writeRecord(app, {
      secrets,
      last: stored?.last ?? null,
      previous: stored?.previous ?? [],
    });

    const prod = yield* production(app, target, root);
    const postgres = app.manifest.data.services.find((service) => service.kind === "postgres");
    // The same defaults as the snapshots use.
    const user = postgres?.user ?? "postgres";
    const database =
      postgres === undefined
        ? null
        : {
            service: postgres.service,
            user,
            database: postgres.database ?? user,
            password: secrets.dbPassword,
          };
    const here = known.find((record) => record.target.host === target.host) ?? null;
    // A first deploy to a new place can start from the data of the place before it.
    const from =
      input.bringData === true && here === null && database !== null
        ? (stored?.last ?? null)
        : null;
    const moved =
      from === null
        ? null
        : yield* step(`Saving the data on ${placeOf(from.target)}.`).pipe(
            Effect.andThen(
              withDeployed(app, from, (old) =>
                data.snapshotOf(old.dataTarget(from.commitSha), {
                  reason: "before-deploy",
                  label: `Moved from ${placeOf(from.target)}`,
                }),
              ),
            ),
            Effect.mapError((error) =>
              failed(
                `The data on ${placeOf(from.target)} could not be saved, so nothing was deployed. ${error.message}`,
              ),
            ),
          );

    const url = urlOf(app, target);
    const override = prodOverride({
      appService: appServiceOf(app),
      database,
      migrate: migrates(app),
      authSecret: secrets.authSecret,
      publicUrl: url,
      variables: yield* readEnvFile(fs, envFilePath(path, config.stateDir, app.app.slug)),
      hostCaPath: prod.ca,
    });
    yield* Effect.gen(function* () {
      yield* fs.writeFileString(overridePathOf(app), override, { mode: ENV_FILE_MODE });
      yield* fs.chmod(overridePathOf(app), ENV_FILE_MODE);
    }).pipe(Effect.mapError(() => failed("Ozone could not write the production settings.")));

    yield* step("Building the production image. The first build takes a few minutes.");
    yield* prod.run("The production image could not be built", ["build"], BUILD_TIMEOUT);
    if (database !== null) {
      yield* step("Starting the production database.");
      yield* prod.run(
        "The production database did not start",
        ["up", "--detach", "--wait", database.service],
        STEP_TIMEOUT,
      );
    }
    if (database !== null && here !== null) {
      yield* step("Taking a snapshot of the production data.");
      // The data is what the last deploy here left, before this one's migrations.
      yield* data.snapshotOf(prod.dataTarget(here.commitSha), { reason: "before-deploy" });
    }
    if (moved !== null) {
      yield* step("Bringing the data over.");
      yield* data.loadOf(prod.dataTarget(null), {
        snapshotId: moved.id,
        appService: appServiceOf(app),
      });
    }
    if (migrates(app)) {
      yield* step("Applying the migrations.");
      yield* migrateStep(
        app,
        prod,
        input.acceptMigrations === true ? (heldBack.get(projectId)?.accept ?? []) : [],
        "A migration that can lose data was held back, and production was not changed:",
      );
    }
    yield* step("Starting the app.");
    yield* startApp(app, prod);
    yield* writeRecord(app, {
      secrets,
      last: { target, url, commitSha, deployedAt: DateTime.formatIso(yield* DateTime.now) },
      previous: known.filter((record) => record.target.host !== target.host),
    });
    if (from !== null) {
      // Two live copies of the same data would drift apart. The old volume stays where it is.
      yield* step(`Stopping the deploy on ${placeOf(from.target)}.`);
      yield* withDeployed(app, from, (old) => old.compose(["stop"])).pipe(Effect.ignore);
    }
  });

  const deploy = Effect.fn("AppDeploy.deploy")(function* (input: OzoneDeployRunInput) {
    const app = yield* registry.resolve(input.projectId);
    if (inFlight.has(input.projectId))
      return yield* failed("A deploy of this app is already running.");
    const hasProdFile = yield* fs
      .exists(path.join(app.workspaceRoot, PROD_COMPOSE_FILE))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasProdFile) {
      return yield* failed(
        `This app has no ${PROD_COMPOSE_FILE}: it was made before Ozone could deploy. Ask its lead to add one like the template's.`,
      );
    }
    failures.delete(input.projectId);
    inFlight.set(input.projectId, "Starting the deploy.");
    yield* deployNow(app, input).pipe(
      Effect.scoped,
      Effect.tapError((error) => Effect.sync(() => failures.set(input.projectId, error.message))),
      Effect.ensuring(Effect.sync(() => inFlight.delete(input.projectId))),
      Effect.ignore,
    );
    return yield* statusOf(app);
  });

  /** In the service's own fiber: a window closed halfway must not stop a restore or a deploy. */
  const toTheEnd = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.forkIn(effect, scope).pipe(Effect.flatMap(Fiber.join));
  /** One piece of work on an app's production at a time; the status says which. */
  const claim = <A>(projectId: ProjectId, doing: string, work: Effect.Effect<A, OzoneAppError>) =>
    Effect.suspend(() => {
      if (inFlight.has(projectId)) {
        return Effect.fail(failed("Production is busy. Try again when it has finished."));
      }
      inFlight.set(projectId, doing);
      return work.pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(projectId))));
    });
  const deployed = Effect.fn("AppDeploy.deployed")(function* (projectId: ProjectId) {
    const app = yield* registry.resolve(projectId);
    const last = (yield* readRecord(app))?.last ?? null;
    if (last === null) return yield* failed("This app has not been deployed.");
    return { app, last };
  });

  return AppDeploy.of({
    status: Effect.fn("AppDeploy.status")(function* (projectId) {
      return yield* statusOf(yield* registry.resolve(projectId));
    }),
    deploy: Effect.fn("AppDeploy.deployToTheEnd")((input) => toTheEnd(deploy(input))),
    stop: Effect.fn("AppDeploy.stop")(function* (projectId) {
      const { app, last } = yield* deployed(projectId);
      const output = yield* docker
        .run({
          args: [...composeArgs(app, last.target), "stop"],
          cwd: app.workspaceRoot,
          timeout: STEP_TIMEOUT,
        })
        .pipe(Effect.mapError((error) => failed(error.detail)));
      if (output.code !== 0) {
        return yield* failed(
          `Docker could not stop it: ${(output.stderr.trim() || output.stdout.trim()).slice(-OUTPUT_TAIL)}`,
        );
      }
      return yield* statusOf(app);
    }),
    snapshots: Effect.fn("AppDeploy.snapshots")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      return yield* data.listOf({ projectId, folder: path.join(app.app.slug, "production") });
    }),
    snapshot: Effect.fn("AppDeploy.snapshot")(function* (input) {
      const { app, last } = yield* deployed(input.projectId);
      return yield* toTheEnd(
        claim(
          input.projectId,
          "Taking a snapshot of the production data.",
          withDeployed(app, last, (prod) =>
            data.snapshotOf(prod.dataTarget(last.commitSha), {
              reason: "manual",
              ...(input.label === undefined ? {} : { label: input.label }),
            }),
          ),
        ),
      );
    }),
    restore: Effect.fn("AppDeploy.restore")(function* (input) {
      const { app, last } = yield* deployed(input.projectId);
      return yield* toTheEnd(
        claim(
          input.projectId,
          "Restoring the production data.",
          withDeployed(app, last, (prod) =>
            data.restoreOf(prod.dataTarget(last.commitSha), {
              snapshotId: input.snapshotId,
              appService: appServiceOf(app),
              // The deployed version expects its own schema, whatever the snapshot's was.
              restart: (migrates(app)
                ? migrateStep(
                    app,
                    prod,
                    [],
                    "The data is restored, but the deployed version needs a migration that can lose data, so the app is stopped. Deploy and apply it to start it:",
                  )
                : Effect.void
              ).pipe(Effect.andThen(startApp(app, prod))),
            }),
          ),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(AppDeploy, make);
