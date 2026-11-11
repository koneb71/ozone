import {
  OzoneAppError,
  OzoneDeployTarget,
  type OzoneDeployRunInput,
  type OzoneDeployStatus,
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
const DeployFile = Schema.fromJsonString(
  Schema.Struct({
    secrets: Schema.Struct({ authSecret: Schema.String, dbPassword: Schema.String }),
    last: Schema.NullOr(DeployRecord),
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

  const directoryOf = (app: ResolvedApp) =>
    path.join(config.stateDir, "ozone", "apps", app.app.slug);
  const fileOf = (app: ResolvedApp) => path.join(directoryOf(app), "deploy.json");
  const portOf = (app: ResolvedApp) => app.app.port + PROD_PORT_OFFSET;
  const urlOf = (app: ResolvedApp, target: OzoneDeployTarget) =>
    target.publicUrl ??
    `http://${target.host === null ? "localhost" : hostName(target.host)}:${portOf(app)}`;

  const readRecord = (app: ResolvedApp) =>
    fs.readFileString(fileOf(app)).pipe(
      Effect.flatMap(decodeDeployFile),
      Effect.orElseSucceed((): DeployFile | null => null),
    );
  const writeRecord = Effect.fn("AppDeploy.writeRecord")(
    function* (app: ResolvedApp, file: DeployFile) {
      const json = yield* encodeDeployFile(file);
      yield* fs.makeDirectory(directoryOf(app), { recursive: true });
      yield* fs.writeFileString(fileOf(app), json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(fileOf(app), ENV_FILE_MODE);
    },
    Effect.mapError(() => failed("Ozone could not save the deploy's settings.")),
  );
  const newSecret = Effect.map(Effect.all([random.uuidV4(), random.uuidV4()]), (parts) =>
    parts.join("").replaceAll("-", ""),
  );

  /** `docker [-H ssh://host] compose` for the app's production project. */
  const composeArgs = (app: ResolvedApp, target: OzoneDeployTarget) => [
    ...(target.host === null ? [] : ["-H", `ssh://${target.host}`]),
    "compose",
    "--project-name",
    `${app.app.slug}-prod`,
    "--project-directory",
    app.workspaceRoot,
    "-f",
    path.join(app.workspaceRoot, PROD_COMPOSE_FILE),
  ];

  const statusOf = Effect.fn("AppDeploy.statusOf")(function* (app: ResolvedApp) {
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
    };
    if (doing !== undefined) return { ...base, state: "deploying" as const, message: doing };
    if (failure !== null) return { ...base, state: "failed" as const, message: failure };
    if (last === null) return NOT_DEPLOYED;
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
    return { ...base, state: running ? ("running" as const) : ("stopped" as const), message: null };
  });

  const deployNow = Effect.fn("AppDeploy.deployNow")(function* (
    app: ResolvedApp,
    target: OzoneDeployTarget,
  ) {
    const projectId = app.app.projectId;
    const root = app.workspaceRoot;
    const step = (doing: string) => Effect.sync(() => inFlight.set(projectId, doing));
    const stored = yield* readRecord(app);
    const secrets = stored?.secrets ?? {
      authSecret: yield* newSecret,
      dbPassword: yield* newSecret,
    };
    // Kept before anything runs: a database is created with its first password and keeps it.
    yield* writeRecord(app, { secrets, last: stored?.last ?? null });

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
    const migrate = database !== null && app.manifest.migrations !== undefined;
    const url = urlOf(app, target);
    // A remote daemon builds with its own network.
    const ca = target.host === null ? yield* hostCaPath(hostEnvironment, fs) : null;
    const overridePath = path.join(directoryOf(app), "compose.prod.override.yaml");
    const override = prodOverride({
      appService: app.manifest.runtime.appService,
      database,
      migrate,
      authSecret: secrets.authSecret,
      publicUrl: url,
      variables: yield* readEnvFile(fs, envFilePath(path, config.stateDir, app.app.slug)),
      hostCaPath: ca,
    });
    yield* Effect.gen(function* () {
      yield* fs.writeFileString(overridePath, override, { mode: ENV_FILE_MODE });
      yield* fs.chmod(overridePath, ENV_FILE_MODE);
    }).pipe(Effect.mapError(() => failed("Ozone could not write the production settings.")));

    const args = [...composeArgs(app, target), "-f", overridePath];
    const env = {
      OZONE_PROD_PORT: String(portOf(app)),
      // On a server it is meant to be reached; here, only from this machine.
      OZONE_PROD_BIND: target.host === null ? "127.0.0.1" : "0.0.0.0",
      // Compose builds through buildx bake, which refuses to read a file outside the project
      // unless allowed, and has no flag for it. The only such file is the bundle Ozone named.
      ...(ca === null ? {} : { BUILDX_BAKE_ENTITLEMENTS_FS: "0" }),
    };
    const run = Effect.fn("AppDeploy.run")(function* (
      what: string,
      command: ReadonlyArray<string>,
      timeout: Duration.Duration,
    ) {
      const output = yield* docker
        .run({
          args: [...args, ...command],
          cwd: root,
          env,
          timeout,
          maxOutputBytes: 2 * 1024 * 1024,
        })
        .pipe(Effect.mapError((error) => failed(error.detail)));
      if (output.code === 0 && !output.timedOut) return;
      // Compose prints its progress on one stream and the reason on either.
      const said = `${output.stdout}\n${output.stderr}`.trim().slice(-OUTPUT_TAIL);
      return yield* failed(
        output.timedOut ? `${what}: it did not finish in time.` : `${what}:\n${said}`,
      );
    });

    yield* step("Building the production image. The first build takes a few minutes.");
    yield* run("The production image could not be built", ["build"], BUILD_TIMEOUT);
    if (database !== null) {
      yield* step("Starting the production database.");
      yield* run(
        "The production database did not start",
        ["up", "--detach", "--wait", database.service],
        STEP_TIMEOUT,
      );
    }
    if (migrate) {
      yield* step("Applying the migrations.");
      yield* run(
        "The migrations could not be applied",
        ["run", "--rm", "-T", "migrate"],
        STEP_TIMEOUT,
      );
    }
    yield* step("Starting the app.");
    yield* run(
      "The app did not start",
      ["up", "--detach", "--wait", "--no-deps", app.manifest.runtime.appService],
      STEP_TIMEOUT,
    );
    yield* writeRecord(app, {
      secrets,
      last: {
        target,
        url,
        commitSha: yield* repo.head(root),
        deployedAt: DateTime.formatIso(yield* DateTime.now),
      },
    });
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
    yield* deployNow(app, input.target).pipe(
      Effect.tapError((error) => Effect.sync(() => failures.set(input.projectId, error.message))),
      Effect.ensuring(Effect.sync(() => inFlight.delete(input.projectId))),
      Effect.ignore,
    );
    return yield* statusOf(app);
  });

  return AppDeploy.of({
    status: Effect.fn("AppDeploy.status")(function* (projectId) {
      return yield* statusOf(yield* registry.resolve(projectId));
    }),
    // Once started it runs to its end in the service's own fiber; the status says how it went.
    deploy: Effect.fn("AppDeploy.deployToTheEnd")((input) =>
      Effect.forkIn(deploy(input), scope).pipe(Effect.flatMap(Fiber.join)),
    ),
    stop: Effect.fn("AppDeploy.stop")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      const last = (yield* readRecord(app))?.last ?? null;
      if (last === null) return yield* failed("This app has not been deployed.");
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
  });
});

export const layer = Layer.effect(AppDeploy, make);
