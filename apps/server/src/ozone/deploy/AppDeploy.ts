import {
  OZONE_DEPLOY_WEBHOOK_PATH,
  OZONE_MANIFEST_FILE_NAME,
  OzoneAppError,
  OzoneDeployTarget,
  OzoneDeployment,
  OzoneRemovedDeployment,
  type OzoneDataRestoreInput,
  type OzoneDataRestoreResult,
  type OzoneDataSnapshotInput,
  type OzoneDeployHistoryResult,
  type OzoneDeployPlace,
  type OzoneDeploymentRemoveInput,
  type OzoneDeploymentRemoveResult,
  type OzoneDeploymentRow,
  type OzoneDeploymentsListInput,
  type OzoneDeploymentsListResult,
  type OzoneDeployLogsInput,
  type OzoneDeployMetrics,
  type OzoneDeployRollbackInput,
  type OzoneDeployRunInput,
  type OzoneDeployStatus,
  type OzoneDeployTrigger,
  type OzoneDeployWebhookInput,
  type OzoneDeployWebhookResult,
  type OzoneEnvVariableValue,
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
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ServerConfig from "../../config.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import { DELETED_RECORD_FILE, decodeDeletedRecord } from "../apps/deletedApp.ts";
import * as BuildRepo from "../builds/BuildRepo.ts";
import * as AppData from "../data/AppData.ts";
import {
  ACCEPT_MIGRATIONS_ENV,
  parseHeldBack,
  type MigrationReport,
} from "../data/migrationGuard.ts";
import {
  composeValue,
  ENV_FILE_MODE,
  envFilePath,
  placeKey,
  readStoredEnv,
} from "../env/envFile.ts";
import * as DockerCli from "../runtime/DockerCli.ts";
import { hostCaPath } from "../runtime/hostCa.ts";
import { failed } from "../errors.ts";
import * as AppServers from "./AppServers.ts";
import * as DokployDeploy from "./DokployDeploy.ts";
import * as HostedDeploy from "./HostedDeploy.ts";
import {
  coveredVolumes,
  HISTORY_LIMIT,
  HOST_DASHBOARD,
  historyEntries,
  parseProbe,
  type ProdFound,
  probeArgs,
  stateOf,
  withDeployment,
} from "./deployments.ts";
import { containerMetrics, parseComposePs } from "./metrics.ts";
import * as Notifier from "./Notifier.ts";
import * as SavedServers from "./SavedServers.ts";
import { proxyNetworkDeclaration, routeOverride } from "./proxy.ts";

/**
 * Runs an app's production image where people can reach it: on this machine, or on a Docker host
 * over SSH. It is a Compose project of its own, with a database of its own, so development data
 * is never touched. Only a person's Delete deployment removes its volume, after a snapshot.
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
    readonly history: (
      projectId: ProjectId,
    ) => Effect.Effect<OzoneDeployHistoryResult, OzoneAppError>;
    /** What a deploy did, step by step, with what Docker said. */
    readonly output: (
      projectId: ProjectId,
      deploymentId: string,
    ) => Effect.Effect<string, OzoneAppError>;
    /**
     * Deploys an earlier version again where the app runs now. Its data stays, unless asked to
     * come back too; then what was written since is kept in a snapshot first.
     */
    readonly rollback: (
      input: OzoneDeployRollbackInput,
    ) => Effect.Effect<OzoneDeployStatus, OzoneAppError>;
    /** Deploys the last commit where the app was last deployed. */
    readonly redeploy: (
      projectId: ProjectId,
      trigger: OzoneDeployTrigger,
      acceptMigrations?: boolean,
    ) => Effect.Effect<OzoneDeployStatus, OzoneAppError>;
    /** Starts a redeploy for the app whose webhook token this is, without waiting for it. */
    readonly redeployByToken: (
      token: string,
    ) => Effect.Effect<"started" | "busy" | "unknown", OzoneAppError>;
    readonly webhook: (
      input: OzoneDeployWebhookInput,
    ) => Effect.Effect<OzoneDeployWebhookResult, OzoneAppError>;
    /** The production containers' logs. */
    readonly logs: (input: OzoneDeployLogsInput) => Effect.Effect<string, OzoneAppError>;
    readonly metrics: (projectId: ProjectId) => Effect.Effect<OzoneDeployMetrics, OzoneAppError>;
    /**
     * Every deployment on record, of registered and deleted apps, where they run now and where they
     * ran before, with what each place holds now. Servers are not searched for anything else.
     */
    readonly deployments: (
      input: OzoneDeploymentsListInput,
    ) => Effect.Effect<OzoneDeploymentsListResult, OzoneAppError>;
    /**
     * Deletes a deployment Ozone runs: a snapshot of its data kept on this machine first, then its
     * containers, images and the volumes that snapshot holds. Runs to its end, whoever was waiting.
     */
    readonly removeDeployment: (
      input: OzoneDeploymentRemoveInput,
    ) => Effect.Effect<OzoneDeploymentRemoveResult, OzoneAppError>;
  }
>()("t3/ozone/deploy/AppDeploy") {}

export const PROD_COMPOSE_FILE = "compose.prod.yaml";
/** Production listens beside development: an app on 41005 is on 42005 in production. */
const PROD_PORT_OFFSET = 1_000;
const BUILD_TIMEOUT = Duration.minutes(20);
const STEP_TIMEOUT = Duration.minutes(5);
const OUTPUT_TAIL = 1_500;
/** How much of each step's output a deploy's log keeps. */
const NOTE_TAIL = 6_000;

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
    /**
     * Where the app was deployed before, one record per place. Their volumes are there until a
     * person deletes that deployment.
     */
    previous: Schema.Array(DeployRecord).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
    /** Oldest first. */
    history: Schema.Array(OzoneDeployment).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
    /** The secret part of the URL that redeploys the app. Null: no such URL. */
    webhookToken: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(null)),
    ),
    /** Deployments a person deleted, oldest first. */
    removed: Schema.Array(OzoneRemovedDeployment).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed([])),
    ),
  }),
);
type DeployFile = typeof DeployFile.Type;
const decodeDeployFile = Schema.decodeUnknownEffect(DeployFile);
const encodeDeployFile = Schema.encodeEffect(DeployFile);

const NOT_DEPLOYED: OzoneDeployStatus = {
  state: "none",
  target: null,
  url: null,
  commitSha: null,
  deployedAt: null,
  message: null,
  migration: null,
  headSha: null,
};

/** The variables the app runs with in production: Ozone's own first, then the app's over them. */
const prodEnv = (input: {
  readonly authSecret: string;
  readonly publicUrl: string;
  readonly databaseUrl: string | null;
  readonly variables: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}): Map<string, string> => {
  const environment = new Map<string, string>([
    ["BETTER_AUTH_SECRET", input.authSecret],
    ["BETTER_AUTH_URL", input.publicUrl],
    ...(input.databaseUrl === null ? [] : [["DATABASE_URL", input.databaseUrl] as const]),
  ]);
  for (const variable of input.variables) environment.set(variable.name, variable.value);
  return environment;
};

/** The app's own variables with the ones for this place on top: there, its value for a name wins. */
const variablesAt = (
  own: ReadonlyArray<OzoneEnvVariableValue>,
  here: ReadonlyArray<OzoneEnvVariableValue>,
): ReadonlyArray<OzoneEnvVariableValue> => {
  const named = new Map(own.map((variable) => [variable.name, variable]));
  for (const variable of here) named.set(variable.name, variable);
  return [...named.values()];
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
  /** Served by the host's proxy at a domain instead of on a port. */
  readonly route: Parameters<typeof routeOverride>[0] | null;
}): string => {
  const { database } = input;
  const databaseUrl =
    database === null
      ? null
      : `postgres://${database.user}:${encodeURIComponent(database.password)}@${database.service}:5432/${database.database}`;
  const appEnvironment = prodEnv({ ...input, databaseUrl });
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
    ...(input.route === null ? [] : routeOverride(input.route)),
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
    ...(input.route === null ? [] : proxyNetworkDeclaration),
    "",
  ].join("\n");
};

/** The host without its user and port: `deploy@example.com:2222` is reached at `example.com`. */
const hostName = (host: string) => host.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
/** Whether two targets are the same place, whose volumes are the same data. */
const samePlace = (left: OzoneDeployPlace, right: OzoneDeployPlace) =>
  left.host === right.host && left.dokploy === right.dokploy && left.hosted === right.hosted;
/** What Ozone cannot do for an app Dokploy runs. */
const onDokploy = (what: string) =>
  failed(`${what} is not available for an app Dokploy runs. Use Dokploy for it.`);
/** What Ozone cannot do for an app a hosting platform runs. */
const onHost = (what: string) =>
  failed(`${what} is not available for an app a hosting platform runs. Use the host for it.`);
/** Whether something other than Ozone runs the app there, and keeps its data. */
const runsElsewhere = (target: OzoneDeployTarget) =>
  target.dokploy !== null || target.hosted !== null;

const make = Effect.gen(function* () {
  const docker = yield* DockerCli.DockerCli;
  const registry = yield* AppRegistry.AppRegistry;
  const repo = yield* BuildRepo.BuildRepo;
  const data = yield* AppData.AppData;
  const servers = yield* AppServers.AppServers;
  const notifier = yield* Notifier.Notifier;
  const dokploy = yield* DokployDeploy.DokployDeploy;
  const hosted = yield* HostedDeploy.HostedDeploy;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const random = yield* SecureRandom.SecureRandom;
  const hostEnvironment = yield* HostProcess.Environment;
  const saved = yield* SavedServers.SavedServers;

  const variablesOn = Effect.fn("AppDeploy.variablesOn")(function* (
    app: ResolvedApp,
    target: OzoneDeployTarget,
  ) {
    const stored = yield* readStoredEnv(fs, envFilePath(path, config.stateDir, app.app.slug));
    return variablesAt(stored.variables, stored.places[placeKey(target)] ?? []);
  });
  const scope = yield* Scope.Scope;
  /** What a deploy in flight is doing, by app. */
  const inFlight = new Map<ProjectId, string>();
  /** Why the last deploy failed, until the next one starts. */
  const failures = new Map<ProjectId, string>();
  /** What the last deploy's migrate step held back, until a deploy runs it. */
  const heldBack = new Map<ProjectId, MigrationReport>();
  /** Deployments being deleted, by app slug: nothing else touches that app's production meanwhile. */
  const removing = new Map<string, string>();

  const appsDirectory = path.join(config.stateDir, "ozone", "apps");
  const directoryOfSlug = (slug: string) => path.join(appsDirectory, slug);
  const fileOfSlug = (slug: string) => path.join(directoryOfSlug(slug), "deploy.json");
  const directoryOf = (app: ResolvedApp) => directoryOfSlug(app.app.slug);
  const outputOf = (app: ResolvedApp, deploymentId: string) =>
    path.join(directoryOf(app), "deploys", `${deploymentId.replace(/[^\w-]/g, "")}.log`);
  const portOf = (app: ResolvedApp) => app.app.port + PROD_PORT_OFFSET;
  const urlOf = (app: ResolvedApp, target: OzoneDeployTarget) =>
    target.domain !== null
      ? `https://${target.domain}`
      : (target.publicUrl ??
        `http://${target.host === null ? "localhost" : hostName(target.host)}:${portOf(app)}`);

  /**
   * The saved settings, or null before the first deploy. A file that exists but cannot be read
   * stops everything: it holds the password the production database was created with.
   */
  const readRecordOf = (slug: string) =>
    fs.readFileString(fileOfSlug(slug)).pipe(
      Effect.map((json): string | null => json),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
      Effect.flatMap((json) => (json === null ? Effect.succeed(null) : decodeDeployFile(json))),
      Effect.mapError(() =>
        failed(
          `Ozone could not read ${fileOfSlug(slug)}, which holds the production database's password. Restore that file before deploying again.`,
        ),
      ),
    );
  const readRecord = (app: ResolvedApp) => readRecordOf(app.app.slug);
  const writeRecordOf = Effect.fn("AppDeploy.writeRecord")(
    function* (slug: string, file: DeployFile) {
      const json = yield* encodeDeployFile(file);
      const temporary = `${fileOfSlug(slug)}.tmp`;
      yield* fs.makeDirectory(directoryOfSlug(slug), { recursive: true });
      // Written whole and then renamed, so a crash never leaves half a password file.
      yield* fs.writeFileString(temporary, json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(temporary, ENV_FILE_MODE);
      yield* fs.rename(temporary, fileOfSlug(slug));
    },
    Effect.mapError(() => failed("Ozone could not save the deploy's settings.")),
  );
  const writeRecord = (app: ResolvedApp, file: DeployFile) => writeRecordOf(app.app.slug, file);
  /** Changes the saved settings of an app that has them. */
  const updateRecordOf = Effect.fn("AppDeploy.updateRecord")(function* (
    slug: string,
    change: (file: DeployFile) => DeployFile,
  ) {
    const stored = yield* readRecordOf(slug);
    if (stored !== null) yield* writeRecordOf(slug, change(stored));
  });
  const updateRecord = (app: ResolvedApp, change: (file: DeployFile) => DeployFile) =>
    updateRecordOf(app.app.slug, change);
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
        headSha: yield* repo.head(app.workspaceRoot),
      };
      if (doing !== undefined) return { ...base, state: "deploying" as const, message: doing };
      if (failure !== null) return { ...base, state: "failed" as const, message: failure };
      if (last === null)
        return { ...NOT_DEPLOYED, migration: base.migration, headSha: base.headSha };
      if (last.target.dokploy !== null) {
        const state = yield* dokploy.state(app, last.target.dokploy);
        return { ...base, state, message: null };
      }
      if (last.target.hosted !== null) {
        const state = yield* hosted.state(app, last.target.hosted);
        return { ...base, state, message: null };
      }
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
    target.dokploy !== null
      ? "Dokploy"
      : target.hosted !== null
        ? "the hosting platform"
        : target.host === null
          ? "this machine"
          : hostName(target.host);

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

  /** Writes a line to a deploy's output; losing it must not stop the deploy. */
  type Note = (text: string) => Effect.Effect<void>;
  const noteTo =
    (file: string | null): Note =>
    (text) =>
      file === null
        ? Effect.void
        : fs
            .writeFileString(file, `${text}\n`, { flag: "a", mode: ENV_FILE_MODE })
            .pipe(Effect.ignore);
  const silent: Note = () => Effect.void;

  /** Docker Compose for the app's production project on `target`, from the files in `root`. */
  const production = Effect.fn("AppDeploy.production")(function* (
    app: ResolvedApp,
    target: OzoneDeployTarget,
    root: string,
    note: Note = silent,
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
      yield* note(`$ docker compose ${command.join(" ")}`);
      const output = yield* compose(command, { timeout });
      // Compose prints its progress on one stream and the reason on either.
      const said = `${output.stdout}\n${output.stderr}`.trim();
      yield* note(said.slice(-NOTE_TAIL));
      if (output.code === 0 && !output.timedOut) return;
      return yield* failed(
        output.timedOut
          ? `${what}: it did not finish in time.`
          : `${what}:\n${said.slice(-OUTPUT_TAIL)}`,
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
    return { ca, compose, run, dataTarget, target, note };
  });
  type Production = Effect.Success<ReturnType<typeof production>>;

  /** Runs `use` against a deploy that exists, from the files of the commit it runs. */
  const withDeployed = Effect.fn("AppDeploy.withDeployed")(function* <A>(
    app: ResolvedApp,
    record: DeployRecord,
    use: (prod: Production) => Effect.Effect<A, OzoneAppError>,
  ) {
    if (record.target.dokploy !== null) return yield* onDokploy("Reaching its data");
    if (record.target.hosted !== null) return yield* onHost("Reaching its data");
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
    yield* prod.note("$ docker compose run --rm migrate");
    const output = yield* prod.compose([
      "run",
      "--rm",
      "-T",
      ...(accepted.length === 0 ? [] : ["-e", `${ACCEPT_MIGRATIONS_ENV}=${accepted.join(" ")}`]),
      "migrate",
    ]);
    const said = `${output.stdout}\n${output.stderr}`.trim();
    yield* prod.note(said.slice(-NOTE_TAIL));
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

  /**
   * Applies a commit's migrations to a database that runs somewhere else, from this machine: the
   * commit's own `migrate` service, pointed at that database. It is a Compose project of its own
   * and starts no database, so it touches nothing a deploy on this machine keeps.
   */
  const migrateElsewhere = Effect.fn("AppDeploy.migrateElsewhere")(function* (
    app: ResolvedApp,
    root: string,
    databaseUrl: string,
    note: Note,
  ) {
    const args = [
      "compose",
      "--project-name",
      `${app.app.slug}-migrate`,
      "--project-directory",
      root,
      "-f",
      path.join(root, PROD_COMPOSE_FILE),
    ];
    yield* note("$ docker compose run --rm --no-deps migrate");
    const output = yield* docker
      .run({
        args: [...args, "run", "--rm", "--no-deps", "--build", "-T", "migrate"],
        cwd: root,
        // Through the environment, so the password is in no command line.
        env: { DATABASE_URL: databaseUrl },
        timeout: BUILD_TIMEOUT,
        maxOutputBytes: 2 * 1024 * 1024,
      })
      .pipe(Effect.mapError((error) => failed(error.detail)));
    const said = `${output.stdout}\n${output.stderr}`.trim();
    yield* note(said.slice(-NOTE_TAIL));
    const held = output.code === 0 ? null : parseHeldBack(said);
    if (held !== null) {
      heldBack.set(app.app.projectId, held);
      return yield* failed(
        `A migration that can lose data was held back, and production was not changed:\n${held.statements.join("\n")}`,
      );
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

  /**
   * Starts the app's new version. Behind the proxy it starts beside the old one, and the old one
   * stops once the proxy sends requests to the new one, so the app never goes down. On a port of
   * its own the old one has to stop first.
   */
  const startApp = Effect.fn("AppDeploy.startApp")(function* (app: ResolvedApp, prod: Production) {
    const service = appServiceOf(app);
    const plainStart = prod.run(
      "The app did not start",
      ["up", "--detach", "--wait", "--no-deps", service],
      STEP_TIMEOUT,
    );
    if (prod.target.domain === null) return yield* plainStart;
    // Stopped copies would be counted, and started with their old settings.
    yield* prod.compose(["rm", "--force", service]).pipe(Effect.ignore);
    const listed = yield* prod.compose(["ps", "--quiet", service]);
    const old = listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (old.length === 0) return yield* plainStart;
    // A copy deployed without the domain is not behind the proxy yet, so count, don't assume.
    const routedBefore = yield* servers.routes(prod.target.host, app.app.slug);
    yield* prod.run(
      "The new version did not start",
      [
        "up",
        "--detach",
        "--wait",
        "--no-deps",
        "--no-recreate",
        "--scale",
        `${service}=${old.length + 1}`,
        service,
      ],
      STEP_TIMEOUT,
    );
    const routed = yield* servers.awaitRoutes(prod.target.host, app.app.slug, routedBefore + 1);
    if (!routed) {
      yield* prod.note("The proxy did not report the new version in time; switching anyway.");
    }
    const hostArgs = prod.target.host === null ? [] : ["-H", `ssh://${prod.target.host}`];
    yield* prod.note(`Stopping the version before: ${old.join(", ")}`);
    for (const command of [["stop", "--time", "20"], ["rm"]]) {
      yield* docker
        .run({ args: [...hostArgs, "container", ...command, ...old], timeout: STEP_TIMEOUT })
        .pipe(Effect.ignore);
    }
  });
  const migrates = (app: ResolvedApp) =>
    app.manifest.migrations !== undefined &&
    app.manifest.data.services.some((service) => service.kind === "postgres");

  interface DeployOptions {
    readonly trigger: OzoneDeployTrigger;
    /** Deploys this commit instead of the last one. */
    readonly commitSha?: string;
    /** Loads this production snapshot before the migrations run. */
    readonly restoreSnapshotId?: string;
    readonly deploymentId: string;
    readonly note: Note;
  }

  const deployNow = Effect.fn("AppDeploy.deployNow")(function* (
    app: ResolvedApp,
    input: OzoneDeployRunInput,
    options: DeployOptions,
  ) {
    const projectId = app.app.projectId;
    const target = input.target;
    const step = (doing: string) =>
      Effect.sync(() => inFlight.set(projectId, doing)).pipe(
        Effect.andThen(options.note(`# ${doing}`)),
      );
    const stored = yield* readRecord(app);
    // Production runs a commit, never a worker's half-done files or the dev `.env`.
    const commitSha = options.commitSha ?? (yield* repo.head(app.workspaceRoot));
    if (commitSha === null) return yield* failed("This app has no commit to deploy yet.");
    const [commit] = yield* repo.log(app.workspaceRoot, { limit: 1, from: commitSha });
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const deployment: OzoneDeployment = {
      id: options.deploymentId,
      trigger: options.trigger,
      target,
      commitSha,
      title: commit?.subject ?? null,
      startedAt,
      finishedAt: null,
      outcome: "running",
      message: null,
      snapshotId: null,
    };
    const secrets = stored?.secrets ?? {
      authSecret: yield* newSecret,
      dbPassword: yield* newSecret,
    };
    const known = [...(stored?.last == null ? [] : [stored.last]), ...(stored?.previous ?? [])];
    const history = withDeployment(stored?.history ?? [], deployment);
    // Kept before anything runs: a database is created with its first password and keeps it.
    yield* writeRecord(app, {
      secrets,
      last: stored?.last ?? null,
      previous: stored?.previous ?? [],
      history,
      webhookToken: stored?.webhookToken ?? null,
      removed: stored?.removed ?? [],
    });
    yield* dropOldOutput(app, history);
    yield* options.note(
      `Deploying ${commitSha.slice(0, 7)}${commit === undefined ? "" : ` "${commit.subject}"`} to ${placeOf(target)}${target.domain === null ? "" : ` as ${target.domain}`}.`,
    );
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
    /** Keeps the deploy as the one that runs, and the place it ran before as one it left. */
    const succeeded = Effect.fn("AppDeploy.succeeded")(function* (
      url: string,
      snapshotId: string | null,
    ) {
      const finishedAt = DateTime.formatIso(yield* DateTime.now);
      yield* updateRecord(app, (file) => ({
        ...file,
        last: { target, url, commitSha, deployedAt: finishedAt },
        previous: known.filter((record) => !samePlace(record.target, target)),
        history: withDeployment(file.history, {
          ...deployment,
          outcome: "succeeded",
          finishedAt,
          snapshotId,
        }),
      }));
    });
    if (target.dokploy !== null) {
      // Dokploy's volumes are out of Ozone's reach, so nothing that needs a snapshot runs there.
      if (input.acceptMigrations === true) {
        return yield* failed(
          "Ozone takes a snapshot before running a migration that can lose data, and it cannot reach the data Dokploy keeps. Back up the database in Dokploy and apply the migration there.",
        );
      }
      const variables = yield* variablesOn(app, target);
      const outcome = yield* dokploy.deploy({
        app,
        target: { ...target, dokploy: target.dokploy },
        commitSha,
        title: commit?.subject ?? null,
        overrideFor: (publicUrl) =>
          prodOverride({
            appService: appServiceOf(app),
            database,
            migrate: migrates(app),
            authSecret: secrets.authSecret,
            publicUrl,
            variables,
            hostCaPath: null,
            route: null,
          }),
        port: portOf(app),
        migrates: migrates(app),
        databaseService: database?.service ?? null,
        note: options.note,
        step,
      });
      if (!outcome.ok) {
        const held = parseHeldBack(outcome.log);
        if (held !== null) {
          heldBack.set(projectId, held);
          return yield* failed(
            `A migration that can lose data was held back, and production was not changed:\n${held.statements.join("\n")}`,
          );
        }
        return yield* failed(
          `Dokploy could not deploy the app:\n${outcome.log.slice(-OUTPUT_TAIL)}`,
        );
      }
      heldBack.delete(projectId);
      yield* succeeded(outcome.url, null);
      yield* options.note(`Running at ${outcome.url}.`);
      return { url: outcome.url, commitSha };
    }
    if (target.hosted !== null) {
      // The host's database is out of a snapshot's reach, as Dokploy's is.
      if (input.acceptMigrations === true) {
        return yield* failed(
          "Ozone takes a snapshot before running a migration that can lose data, and it cannot take one of the data a hosting platform keeps. Back up the database on the host and apply the migration there.",
        );
      }
      const variables = yield* variablesOn(app, target);
      // The commit's folder lasts as long as this deploy, whichever step asks for it first.
      const deployScope = yield* Scope.Scope;
      const files = yield* Effect.cached(
        exportCommit(app, commitSha).pipe(Scope.provide(deployScope)),
      );
      const outcome = yield* hosted.deploy({
        app,
        target: { ...target, hosted: target.hosted },
        commitSha,
        envFor: (publicUrl, databaseUrl) =>
          prodEnv({ authSecret: secrets.authSecret, publicUrl, databaseUrl, variables }),
        migrate: migrates(app)
          ? (databaseUrl) =>
              Effect.flatMap(files, (root) =>
                migrateElsewhere(app, root, databaseUrl, options.note),
              )
          : null,
        files,
        note: options.note,
        step,
      });
      if (!outcome.ok) {
        return yield* failed(
          `The host could not deploy the app:\n${outcome.log.slice(-OUTPUT_TAIL)}`,
        );
      }
      heldBack.delete(projectId);
      yield* succeeded(outcome.url, null);
      yield* options.note(`Running at ${outcome.url}.`);
      return { url: outcome.url, commitSha };
    }
    const root = yield* exportCommit(app, commitSha);
    const prod = yield* production(app, target, root, options.note);
    const here = known.find((record) => samePlace(record.target, target)) ?? null;
    // A first deploy to a new place can start from the data of the place before it, unless
    // Dokploy keeps that data.
    const from =
      input.bringData === true &&
      here === null &&
      database !== null &&
      stored?.last != null &&
      !runsElsewhere(stored.last.target)
        ? stored.last
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

    if (target.domain !== null) {
      yield* step(`Starting the proxy on ${placeOf(target)}.`);
      yield* servers.ensureProxy(target.host);
    }
    const url = urlOf(app, target);
    const override = prodOverride({
      appService: appServiceOf(app),
      database,
      migrate: migrates(app),
      authSecret: secrets.authSecret,
      publicUrl: url,
      variables: yield* variablesOn(app, target),
      hostCaPath: prod.ca,
      route:
        target.domain === null
          ? null
          : {
              slug: app.app.slug,
              domain: target.domain,
              appPort: app.manifest.runtime.appPort,
            },
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
    let snapshotId: string | null = moved?.id ?? null;
    if (database !== null && here !== null) {
      yield* step("Taking a snapshot of the production data.");
      // The data is what the last deploy here left, before this one's migrations.
      const taken = yield* data.snapshotOf(prod.dataTarget(here.commitSha), {
        reason: "before-deploy",
      });
      snapshotId = taken.id;
    }
    const load = moved?.id ?? options.restoreSnapshotId ?? null;
    if (load !== null) {
      yield* step(moved === null ? "Bringing back the data from then." : "Bringing the data over.");
      yield* data.loadOf(prod.dataTarget(null), {
        snapshotId: load,
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
    yield* succeeded(url, snapshotId);
    if (from !== null) {
      // Two live copies of the same data would drift apart. The old volume stays there until a
      // person deletes that deployment.
      yield* step(`Stopping the deploy on ${placeOf(from.target)}.`);
      yield* withDeployed(app, from, (old) => old.compose(["stop"])).pipe(Effect.ignore);
    }
    yield* options.note(`Running at ${url}.`);
    return { url, commitSha };
  });

  /** Removes the output of deploys no longer in the history. */
  const dropOldOutput = (app: ResolvedApp, history: ReadonlyArray<OzoneDeployment>) =>
    fs.readDirectory(path.join(directoryOf(app), "deploys")).pipe(
      Effect.flatMap((files) => {
        const kept = new Set(history.map((entry) => path.basename(outputOf(app, entry.id))));
        return Effect.forEach(
          files.filter((file) => !kept.has(file)),
          (file) => fs.remove(path.join(directoryOf(app), "deploys", file)),
          { discard: true },
        );
      }),
      Effect.ignore,
    );

  const deploy = Effect.fn("AppDeploy.deploy")(function* (
    input: OzoneDeployRunInput,
    options: Omit<DeployOptions, "deploymentId" | "note">,
  ) {
    const app = yield* registry.resolve(input.projectId);
    if (inFlight.has(input.projectId))
      return yield* failed("A deploy of this app is already running.");
    if (removing.has(app.app.slug)) return yield* failed(removing.get(app.app.slug) ?? "");
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
    const deploymentId = `${DateTime.formatIso(yield* DateTime.now)
      .replace(/[^\d]/g, "")
      .slice(0, 14)}-${(yield* random.uuidV4()).slice(0, 8)}`;
    const outputFile = outputOf(app, deploymentId);
    const note = yield* fs.makeDirectory(path.dirname(outputFile), { recursive: true }).pipe(
      Effect.as(noteTo(outputFile)),
      Effect.orElseSucceed(() => silent),
    );
    const notice = (
      event: "deploy.succeeded" | "deploy.failed",
      title: string,
      detail: string | null,
      url: string | null,
      commitSha: string | null,
    ) => notifier.notify({ event, app: app.app.name, title, detail, url, commitSha });
    yield* deployNow(app, input, { ...options, deploymentId, note }).pipe(
      Effect.scoped,
      Effect.tap(({ url, commitSha }) =>
        notice(
          "deploy.succeeded",
          `${app.app.name} is deployed${options.trigger === "rollback" ? " (rolled back)" : ""}.`,
          null,
          url,
          commitSha,
        ),
      ),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          failures.set(input.projectId, error.message);
          yield* note(`Failed: ${error.message}`);
          const finishedAt = DateTime.formatIso(yield* DateTime.now);
          yield* updateRecord(app, (file) => ({
            ...file,
            history: file.history.map((entry) =>
              entry.id === deploymentId
                ? { ...entry, outcome: "failed" as const, finishedAt, message: error.message }
                : entry,
            ),
          })).pipe(Effect.ignore);
          yield* notice(
            "deploy.failed",
            `The deploy of ${app.app.name} failed.`,
            error.message.slice(0, 600),
            null,
            null,
          );
        }),
      ),
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
    const deleting = removing.get(app.app.slug);
    if (deleting !== undefined) return yield* failed(deleting);
    const record = yield* readRecord(app);
    const last = record?.last ?? null;
    if (record === null || last === null) return yield* failed("This app has not been deployed.");
    return { app, last, record };
  });
  const hostArgsOf = (target: OzoneDeployTarget) =>
    target.host === null ? [] : ["-H", `ssh://${target.host}`];

  const redeploy = Effect.fn("AppDeploy.redeploy")(function* (
    projectId: ProjectId,
    trigger: OzoneDeployTrigger,
    acceptMigrations = false,
  ) {
    const { last } = yield* deployed(projectId);
    return yield* deploy(
      { projectId, target: last.target, ...(acceptMigrations ? { acceptMigrations } : {}) },
      { trigger },
    );
  });

  /** What is left of a deleted app beside its snapshots, or null. */
  const deletedRecordOf = (slug: string) =>
    fs
      .readFileString(
        path.join(AppData.backupFolder(path, config.stateDir, slug), DELETED_RECORD_FILE),
      )
      .pipe(
        Effect.flatMap(decodeDeletedRecord),
        Effect.orElseSucceed(() => null),
      );

  /** The app a deployment on record belongs to: registered, or deleted with its folder kept. */
  const appOfSlug = Effect.fn("AppDeploy.appOfSlug")(function* (slug: string) {
    const registered = (yield* registry.list).find((app) => app.slug === slug);
    if (registered !== undefined) return yield* registry.resolve(registered.projectId);
    const deleted = yield* deletedRecordOf(slug);
    if (deleted === null) {
      return yield* failed(
        "Ozone no longer knows where this app's folder is. Bring the app back from Home first.",
      );
    }
    const manifest = yield* AppRegistry.readAppManifest(deleted.workspaceRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(() =>
        failed(
          `The app's folder at ${deleted.workspaceRoot} is gone, so Ozone cannot save its data first. Nothing was removed.`,
        ),
      ),
    );
    return { app: deleted.app, workspaceRoot: deleted.workspaceRoot, manifest } as ResolvedApp;
  });

  /** The part of a failed Docker call a person can act on: SSH's own words when it failed. */
  const machineProblem = (output: { readonly stdout: string; readonly stderr: string }) => {
    const said = output.stderr.trim() || output.stdout.trim();
    const fromSsh = /stderr=(.+)$/s.exec(said)?.[1]?.trim();
    return (fromSsh ?? said).slice(-300);
  };
  /** What one machine holds of each app's production project, or why it did not answer. */
  const probe = Effect.fn("AppDeploy.probe")(function* (
    host: string | null,
    slugs: ReadonlyArray<string>,
  ) {
    const args = probeArgs(host === null ? [] : ["-H", `ssh://${host}`], slugs);
    const ask = (argv: ReadonlyArray<string>) =>
      docker.run({ args: argv, timeout: Duration.seconds(20) }).pipe(
        Effect.mapError((error) => error.detail),
        Effect.flatMap((output) =>
          output.code === 0 && !output.timedOut
            ? Effect.succeed(output.stdout)
            : Effect.fail(output.timedOut ? "It did not answer in time." : machineProblem(output)),
        ),
      );
    const [containers, volumes] = yield* Effect.all([ask(args.containers), ask(args.volumes)]);
    return parseProbe(slugs, { containers, volumes });
  });

  /** The files production was started from, or the app's own when that commit cannot be read. */
  const filesFor = Effect.fn("AppDeploy.filesFor")(function* (
    app: ResolvedApp,
    record: DeployRecord,
  ) {
    if (record.commitSha !== null) {
      const exported = yield* exportCommit(app, record.commitSha).pipe(Effect.option);
      if (Option.isSome(exported)) return exported.value;
    }
    const hasProdFile = yield* fs
      .exists(path.join(app.workspaceRoot, PROD_COMPOSE_FILE))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasProdFile) {
      return yield* failed(
        `Ozone could not find the app's ${PROD_COMPOSE_FILE}, so it cannot save its data first. Nothing was removed.`,
      );
    }
    return app.workspaceRoot;
  });

  const deploymentsOf = Effect.fn("AppDeploy.deployments")(function* (
    input: OzoneDeploymentsListInput,
  ) {
    const registered = yield* registry.list;
    const bySlug = new Map(registered.map((app) => [app.slug, app]));
    const only =
      input.projectId === undefined
        ? undefined
        : registered.find((app) => app.projectId === input.projectId)?.slug;
    if (input.projectId !== undefined && only === undefined) return { deployments: [] };
    const slugs =
      only === undefined
        ? yield* fs.readDirectory(appsDirectory).pipe(Effect.orElseSucceed(() => []))
        : [only];
    const savedServers = (yield* saved.list.pipe(Effect.orElseSucceed(() => ({ servers: [] }))))
      .servers;

    const known = yield* Effect.forEach(slugs, (slug) =>
      readRecordOf(slug).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`Ozone skipped a deploy record: ${error.message}`).pipe(
            Effect.as(null),
          ),
        ),
        Effect.flatMap((file) =>
          file === null || (file.last === null && file.previous.length === 0)
            ? Effect.succeed([])
            : Effect.gen(function* () {
                const app = bySlug.get(slug);
                const deleted = app === undefined ? yield* deletedRecordOf(slug) : null;
                const folderKept =
                  deleted !== null &&
                  (yield* fs
                    .exists(path.join(deleted.workspaceRoot, OZONE_MANIFEST_FILE_NAME))
                    .pipe(Effect.orElseSucceed(() => false)));
                const owner = {
                  slug,
                  appName: app?.name ?? deleted?.app.name ?? slug,
                  projectId: app?.projectId ?? null,
                  // Why it cannot be deleted from here whatever runs there, or null.
                  blocked:
                    app !== undefined || folderKept
                      ? null
                      : deleted === null
                        ? "Ozone no longer knows where this app's folder is. Bring the app back from Home first."
                        : "The app's folder is gone, so Ozone cannot save its data first.",
                };
                return [
                  ...(file.last === null ? [] : [{ ...owner, record: file.last, current: true }]),
                  ...file.previous.map((record) => ({ ...owner, record, current: false })),
                ];
              }),
        ),
      ),
    ).pipe(Effect.map((groups) => groups.flat()));

    // Each machine is asked once, for all its apps, and one that does not answer marks only its own.
    const machines = [
      ...new Set(
        known
          .filter((entry) => !runsElsewhere(entry.record.target))
          .map((entry) => entry.record.target.host),
      ),
    ];
    interface Probed {
      readonly found: ReadonlyMap<string, ProdFound> | null;
      readonly problem: string | null;
    }
    const probed = new Map<string | null, Probed>(
      yield* Effect.forEach(
        machines,
        (host) =>
          probe(
            host,
            known
              .filter(
                (entry) => !runsElsewhere(entry.record.target) && entry.record.target.host === host,
              )
              .map((entry) => entry.slug),
          ).pipe(
            Effect.map((found): readonly [string | null, Probed] => [
              host,
              { found, problem: null },
            ]),
            Effect.catch((problem) =>
              Effect.succeed<readonly [string | null, Probed]>([
                host,
                { found: null, problem: String(problem) },
              ]),
            ),
          ),
        { concurrency: 4 },
      ),
    );

    const deployments = known.map(({ record, current, blocked, ...owner }): OzoneDeploymentRow => {
      const { target } = record;
      const dokployServer =
        target.dokploy === null
          ? undefined
          : savedServers.find((server) => server.id === target.dokploy);
      const hostServer =
        target.hosted === null
          ? undefined
          : savedServers.find((server) => server.id === target.hosted);
      const sshServer =
        target.host === null
          ? undefined
          : savedServers.find((server) => server.kind === "ssh" && server.host === target.host);
      const placeLabel =
        target.dokploy !== null
          ? (dokployServer?.name ?? "Dokploy")
          : target.hosted !== null
            ? (hostServer?.name ?? "A hosting platform")
            : target.host === null
              ? "This computer"
              : (sshServer?.name ?? hostName(target.host));
      const base = {
        ...owner,
        place: { host: target.host, dokploy: target.dokploy, hosted: target.hosted },
        placeLabel,
        serverId: target.dokploy ?? target.hosted ?? sshServer?.id ?? null,
        current,
        url: record.url,
        domain: target.domain,
        commitSha: record.commitSha,
        deployedAt: record.deployedAt,
        manageUrl:
          dokployServer?.kind === "dokploy"
            ? dokployServer.url
            : hostServer?.kind === "host"
              ? HOST_DASHBOARD[hostServer.provider]
              : null,
      };
      if (runsElsewhere(target)) {
        return {
          ...base,
          state: "elsewhere",
          detail: null,
          removable: false,
          whyNot: `Ozone does not delete what ${target.dokploy !== null ? "Dokploy" : "a hosting platform"} runs. Delete it there.`,
        };
      }
      const busy =
        removing.get(owner.slug) ??
        (owner.projectId === null ? undefined : inFlight.get(owner.projectId));
      if (busy !== undefined) {
        return { ...base, state: "busy", detail: busy, removable: false, whyNot: busy };
      }
      const machine = probed.get(target.host);
      if (machine === undefined || machine.found === null) {
        const detail = `Ozone could not reach ${placeLabel}: ${machine?.problem ?? "no answer"}`;
        return { ...base, state: "unreachable", detail, removable: false, whyNot: detail };
      }
      const state = stateOf(machine.found.get(owner.slug) ?? { containerStates: [], volumes: [] });
      return { ...base, state, detail: null, removable: blocked === null, whyNot: blocked };
    });
    return {
      deployments: deployments.toSorted(
        (left, right) =>
          left.appName.localeCompare(right.appName) || Number(right.current) - Number(left.current),
      ),
    };
  });

  const removeDeployment = Effect.fn("AppDeploy.removeDeployment")(function* (
    input: OzoneDeploymentRemoveInput,
  ) {
    const { slug } = input;
    const record = yield* readRecordOf(slug);
    const entry = [
      ...(record?.last === null || record === null ? [] : [record.last]),
      ...(record?.previous ?? []),
    ].find((known) => samePlace(known.target, input.place));
    if (entry === undefined) return yield* failed("Ozone has no deployment of this app there.");
    if (entry.target.dokploy !== null) {
      return yield* failed("Ozone does not delete what Dokploy runs. Delete it in Dokploy.");
    }
    if (entry.target.hosted !== null) {
      return yield* failed(
        "Ozone does not delete what a hosting platform runs. Delete it on the host.",
      );
    }
    const app = yield* appOfSlug(slug);
    const where = placeOf(entry.target);
    const doing = `Deleting the deployment on ${where}.`;
    const isRegistered = (yield* registry.list).some(
      (known) => known.projectId === app.app.projectId,
    );

    const work = Effect.gen(function* () {
      const found = yield* probe(entry.target.host, [slug]).pipe(
        Effect.mapError((problem) =>
          failed(`Ozone could not reach ${where}, so nothing was removed. ${problem}`),
        ),
      );
      const here = found.get(slug) ?? { containerStates: [], volumes: [] };
      const covered = coveredVolumes(slug, app.manifest.data.services, here.volumes);
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const prod = yield* production(app, entry.target, yield* filesFor(app, entry));
          const kept =
            covered.length === 0
              ? null
              : yield* data.snapshotOf(prod.dataTarget(entry.commitSha), {
                  reason: "before-delete",
                  label: `Before deleting the deployment on ${where}`,
                });
          yield* prod
            .run(
              "Docker could not remove the containers",
              ["down", "--remove-orphans", "--rmi", "local"],
              STEP_TIMEOUT,
            )
            .pipe(
              Effect.mapError((error) =>
                kept === null
                  ? error
                  : failed(`The data is saved as snapshot ${kept.id}, but ${error.message}`),
              ),
            );
          return kept;
        }),
      );
      if (covered.length > 0) {
        const output = yield* docker
          .run({
            args: [...hostArgsOf(entry.target), "volume", "rm", ...covered],
            allowDataRemoval: true,
            timeout: STEP_TIMEOUT,
          })
          .pipe(Effect.mapError((error) => failed(error.detail)));
        if (output.code !== 0 || output.timedOut) {
          return yield* failed(
            `The data is saved as snapshot ${snapshot?.id ?? ""}, but Docker could not remove its volume: ${(output.stderr.trim() || output.stdout.trim()).slice(-OUTPUT_TAIL)}`,
          );
        }
      }
      const removedAt = DateTime.formatIso(yield* DateTime.now);
      const clearsLast = record?.last != null && samePlace(record.last.target, entry.target);
      yield* updateRecordOf(slug, (file) => ({
        ...file,
        last: clearsLast ? null : file.last,
        previous: file.previous.filter((known) => !samePlace(known.target, entry.target)),
        webhookToken: clearsLast ? null : file.webhookToken,
        removed: [
          ...file.removed,
          { target: entry.target, removedAt, snapshotId: snapshot?.id ?? null },
        ].slice(-HISTORY_LIMIT),
      }));
      if (clearsLast) {
        failures.delete(app.app.projectId);
        heldBack.delete(app.app.projectId);
      }
      // It holds a copy of production's secrets, and nothing Ozone runs reads it any more.
      const after = yield* readRecordOf(slug);
      const ozoneRunsMore = [after?.last ?? null, ...(after?.previous ?? [])].some(
        (known) => known !== null && !runsElsewhere(known.target),
      );
      if (!ozoneRunsMore) yield* fs.remove(overridePathOf(app)).pipe(Effect.ignore);
      return {
        snapshot,
        keptVolumes: here.volumes.filter((name) => !covered.includes(name)),
      };
    });

    return yield* toTheEnd(
      Effect.suspend(() => {
        if (removing.has(slug)) {
          return Effect.fail(failed("This deployment is already being deleted."));
        }
        removing.set(slug, doing);
        return (isRegistered ? claim(app.app.projectId, doing, work) : work).pipe(
          Effect.ensuring(Effect.sync(() => removing.delete(slug))),
        );
      }),
    );
  });

  return AppDeploy.of({
    status: Effect.fn("AppDeploy.status")(function* (projectId) {
      return yield* statusOf(yield* registry.resolve(projectId));
    }),
    deploy: Effect.fn("AppDeploy.deployToTheEnd")((input) =>
      toTheEnd(deploy(input, { trigger: "person" })),
    ),
    stop: Effect.fn("AppDeploy.stop")(function* (projectId) {
      const { app, last } = yield* deployed(projectId);
      if (last.target.dokploy !== null) {
        yield* dokploy.stop(app, last.target.dokploy);
        return yield* statusOf(app);
      }
      if (last.target.hosted !== null) {
        yield* hosted.stop(app, last.target.hosted);
        return yield* statusOf(app);
      }
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
    history: Effect.fn("AppDeploy.history")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      const record = yield* readRecord(app);
      if (record === null) return { deployments: [], removed: [] };
      const snapshots = yield* data.listOf({
        projectId,
        folder: path.join(app.app.slug, "production"),
      });
      return {
        deployments: historyEntries({
          history: record.history,
          last: record.last,
          snapshotIds: new Set(snapshots.map((snapshot) => snapshot.id)),
          inFlight: inFlight.has(projectId),
        }),
        removed: record.removed.toReversed(),
      };
    }),
    output: Effect.fn("AppDeploy.output")(function* (projectId, deploymentId) {
      const app = yield* registry.resolve(projectId);
      return yield* fs
        .readFileString(outputOf(app, deploymentId))
        .pipe(Effect.mapError(() => failed("The output of that deploy is no longer kept.")));
    }),
    rollback: Effect.fn("AppDeploy.rollback")(function* (input) {
      const { app, last, record } = yield* deployed(input.projectId);
      const entries = historyEntries({
        history: record.history,
        last,
        snapshotIds: new Set(
          (yield* data.listOf({
            projectId: input.projectId,
            folder: path.join(app.app.slug, "production"),
          })).map((snapshot) => snapshot.id),
        ),
        inFlight: inFlight.has(input.projectId),
      });
      // Dokploy builds the branch's tip; an older commit would mean rewriting the branch.
      if (last.target.dokploy !== null) return yield* onDokploy("Deploying an earlier version");
      // A host builds the branch's tip too.
      if (last.target.hosted !== null) return yield* onHost("Deploying an earlier version");
      const chosen = entries.find((entry) => entry.id === input.deploymentId);
      if (chosen === undefined || chosen.outcome !== "succeeded" || chosen.commitSha === null) {
        return yield* failed("Only a deploy that succeeded can be deployed again.");
      }
      if (input.restoreData === true && chosen.dataSnapshotId === null) {
        return yield* failed("The data as that version left it is no longer kept.");
      }
      return yield* toTheEnd(
        deploy(
          { projectId: input.projectId, target: last.target },
          {
            trigger: "rollback",
            commitSha: chosen.commitSha,
            ...(input.restoreData === true && chosen.dataSnapshotId !== null
              ? { restoreSnapshotId: chosen.dataSnapshotId }
              : {}),
          },
        ),
      );
    }),
    redeploy: Effect.fn("AppDeploy.redeployToTheEnd")((projectId, trigger, acceptMigrations) =>
      toTheEnd(redeploy(projectId, trigger, acceptMigrations)),
    ),
    redeployByToken: Effect.fn("AppDeploy.redeployByToken")(function* (token) {
      if (!/^[0-9a-f]{64}$/.test(token)) return "unknown" as const;
      for (const app of yield* registry.list) {
        const resolved = yield* registry.resolve(app.projectId).pipe(Effect.option);
        if (resolved._tag === "None") continue;
        const record = yield* readRecord(resolved.value).pipe(Effect.orElseSucceed(() => null));
        if (record?.webhookToken !== token || record.last === null) continue;
        if (inFlight.has(app.projectId) || removing.has(app.slug)) return "busy" as const;
        yield* Effect.forkIn(redeploy(app.projectId, "webhook").pipe(Effect.ignore), scope);
        return "started" as const;
      }
      return "unknown" as const;
    }),
    webhook: Effect.fn("AppDeploy.webhook")(function* (input) {
      const { app, record } = yield* deployed(input.projectId);
      const token =
        input.action === "disable"
          ? null
          : input.action === "rotate" || record.webhookToken === null
            ? `${yield* newSecret}`
            : record.webhookToken;
      if (token !== record.webhookToken) {
        yield* updateRecord(app, (file) => ({ ...file, webhookToken: token }));
      }
      return { path: token === null ? null : `${OZONE_DEPLOY_WEBHOOK_PATH}/${token}` };
    }),
    logs: Effect.fn("AppDeploy.logs")(function* (input) {
      const { app, last } = yield* deployed(input.projectId);
      if (last.target.dokploy !== null) {
        return yield* dokploy.logs(
          app,
          last.target.dokploy,
          input.service ?? appServiceOf(app),
          input.tail ?? 300,
        );
      }
      if (last.target.hosted !== null) {
        return yield* hosted.logs(app, last.target.hosted, input.tail ?? 300);
      }
      const output = yield* docker
        .run({
          args: [
            ...composeArgs(app, last.target),
            "logs",
            "--no-color",
            "--timestamps",
            "--tail",
            String(input.tail ?? 300),
            input.service ?? appServiceOf(app),
          ],
          cwd: app.workspaceRoot,
          timeout: Duration.seconds(30),
          maxOutputBytes: 1024 * 1024,
        })
        .pipe(Effect.mapError((error) => failed(error.detail)));
      return `${output.stdout}${output.stderr}`;
    }),
    deployments: deploymentsOf,
    removeDeployment,
    metrics: Effect.fn("AppDeploy.metrics")(function* (projectId) {
      const { app, last } = yield* deployed(projectId);
      if (last.target.dokploy !== null) return yield* onDokploy("Monitoring");
      if (last.target.hosted !== null) return yield* onHost("Monitoring");
      const ps = yield* docker
        .run({
          args: [...composeArgs(app, last.target), "ps", "--all", "--format", "json"],
          cwd: app.workspaceRoot,
          timeout: Duration.seconds(30),
        })
        .pipe(Effect.mapError((error) => failed(error.detail)));
      const containers = parseComposePs(ps.stdout);
      const running = containers.filter((container) => container.state === "running");
      const stats =
        running.length === 0
          ? ""
          : (yield* docker
              .run({
                args: [
                  ...hostArgsOf(last.target),
                  "stats",
                  "--no-stream",
                  "--format",
                  "{{json .}}",
                  ...running.map((container) => container.id),
                ],
                timeout: Duration.seconds(30),
              })
              .pipe(Effect.mapError((error) => failed(error.detail)))).stdout;
      return {
        containers: containerMetrics(containers, stats),
        measuredAt: DateTime.formatIso(yield* DateTime.now),
      };
    }),
  });
});

export const layer = Layer.effect(AppDeploy, make);
