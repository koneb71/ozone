import { OzoneAppError, type OzoneDeployTarget } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import { ENV_FILE_MODE } from "../env/envFile.ts";
import * as Dokploy from "./Dokploy.ts";
import * as SavedServers from "./SavedServers.ts";

/** Ozone's settings for the app, written by Dokploy beside the clone it builds from. */
const OVERRIDE_FILE = "ozone.override.yaml";
const PROD_COMPOSE_FILE = "compose.prod.yaml";
const DEPLOY_TIMEOUT = Duration.minutes(25);

export interface DokployDeployInput {
  readonly app: ResolvedApp;
  readonly target: OzoneDeployTarget & { readonly dokploy: string };
  readonly commitSha: string;
  readonly title: string | null;
  /** The override `compose.prod.yaml` runs with, for the address people reach the app at. */
  readonly overrideFor: (publicUrl: string) => string;
  readonly port: number;
  readonly migrates: boolean;
  readonly databaseService: string | null;
  readonly note: (text: string) => Effect.Effect<void>;
  readonly step: (doing: string) => Effect.Effect<void>;
}

export type DokployOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly log: string };

export type DokployState = "running" | "stopped" | "deploying" | "failed";

/**
 * Deploys an app with Dokploy. Dokploy clones the app's Git remote, so Ozone pushes the commit
 * there first; Ozone's secrets and settings reach it as a file Dokploy writes beside the clone.
 * Dokploy then owns the containers, the domain and the certificate. Nothing here deletes the
 * Dokploy service, so its volumes stay.
 */
export class DokployDeploy extends Context.Service<
  DokployDeploy,
  {
    readonly deploy: (input: DokployDeployInput) => Effect.Effect<DokployOutcome, OzoneAppError>;
    readonly state: (
      app: ResolvedApp,
      serverId: string,
    ) => Effect.Effect<DokployState, OzoneAppError>;
    readonly stop: (app: ResolvedApp, serverId: string) => Effect.Effect<void, OzoneAppError>;
    readonly logs: (
      app: ResolvedApp,
      serverId: string,
      service: string,
      tail: number,
    ) => Effect.Effect<string, OzoneAppError>;
  }
>()("t3/ozone/deploy/DokployDeploy") {}

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

const Link = Schema.Struct({
  serverId: Schema.String,
  composeId: Schema.String,
  appName: Schema.String,
  mountId: Schema.NullOr(Schema.String),
  domainId: Schema.NullOr(Schema.String),
  domain: Schema.NullOr(Schema.String),
});
type Link = typeof Link.Type;
const LinkFile = Schema.fromJsonString(Link);
const decodeLink = Schema.decodeUnknownEffect(LinkFile);
const encodeLink = Schema.encodeEffect(LinkFile);

const ComposeRow = Schema.Struct({
  composeId: Schema.String,
  appName: Schema.String,
  composeStatus: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeComposeRow = Schema.decodeUnknownEffect(ComposeRow);
const CreatedProject = Schema.Struct({
  project: Schema.optionalKey(Schema.Struct({ projectId: Schema.String })),
  projectId: Schema.optionalKey(Schema.String),
  environment: Schema.optionalKey(Schema.Struct({ environmentId: Schema.String })),
});
const decodeCreatedProject = Schema.decodeUnknownEffect(CreatedProject);
const Deployment = Schema.Struct({
  deploymentId: Schema.String,
  status: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
type Deployment = typeof Deployment.Type;
const decodeDeployments = Schema.decodeUnknownEffect(Schema.Array(Deployment));
const decodeMount = Schema.decodeUnknownEffect(Schema.Struct({ mountId: Schema.String }));
const decodeDomain = Schema.decodeUnknownEffect(Schema.Struct({ domainId: Schema.String }));
const Container = Schema.Struct({ containerId: Schema.String, name: Schema.String });
const decodeContainers = Schema.decodeUnknownEffect(Schema.Array(Container));

const malformed = (what: string) => () =>
  failed(`Dokploy answered ${what} in a way Ozone does not know.`);

/**
 * The command Dokploy runs in the clone: the database, then the migrations, then the app, each
 * with Ozone's settings. Dokploy allows only `docker compose` steps joined by `&&`.
 */
export const dokployCommand = (input: {
  readonly appName: string;
  readonly appService: string;
  readonly databaseService: string | null;
  readonly migrates: boolean;
}): string => {
  const compose = `compose -p ${input.appName} -f ${PROD_COMPOSE_FILE} -f ../files/${OVERRIDE_FILE}`;
  const steps = [
    ...(input.databaseService === null
      ? []
      : [`${compose} up -d --build --wait ${input.databaseService}`]),
    ...(input.migrates ? [`${compose} run --rm --build -T migrate`] : []),
    `${compose} up -d --build --remove-orphans ${input.appService}`,
  ];
  return steps.map((step, index) => (index === 0 ? step : `docker ${step}`)).join(" && ");
};

/** The variables `compose.prod.yaml` reads, in the `.env` Dokploy writes beside it. */
const dokployEnv = (input: { readonly port: number; readonly domain: string | null }): string =>
  [
    `OZONE_PROD_PORT=${input.port}`,
    // Behind Dokploy's proxy the port is only for the server itself.
    `OZONE_PROD_BIND=${input.domain === null ? "0.0.0.0" : "127.0.0.1"}`,
    "",
  ].join("\n");

/** A remote Dokploy can clone: a path on this machine is not one. */
export const cloneableUrl = (url: string): boolean =>
  /^(?:https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/.test(url);

const make = Effect.gen(function* () {
  const api = yield* Dokploy.Dokploy;
  const saved = yield* SavedServers.SavedServers;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const linkFileOf = (app: ResolvedApp) =>
    path.join(config.stateDir, "ozone", "apps", app.app.slug, "dokploy.json");
  const readLink = (app: ResolvedApp) =>
    fs.readFileString(linkFileOf(app)).pipe(
      Effect.flatMap(decodeLink),
      Effect.map((link): Link | null => link),
      Effect.orElseSucceed(() => null),
    );
  const writeLink = Effect.fn("DokployDeploy.writeLink")(
    function* (app: ResolvedApp, link: Link) {
      yield* fs.makeDirectory(path.dirname(linkFileOf(app)), { recursive: true });
      yield* fs.writeFileString(linkFileOf(app), yield* encodeLink(link), { mode: ENV_FILE_MODE });
    },
    Effect.mapError(() => failed("Ozone could not save where Dokploy runs the app.")),
  );
  const linked = Effect.fn("DokployDeploy.linked")(function* (app: ResolvedApp, serverId: string) {
    const link = yield* readLink(app);
    if (link === null || link.serverId !== serverId) {
      return yield* failed("Ozone has not deployed this app to that Dokploy server yet.");
    }
    return { link, access: yield* saved.dokploy(serverId) };
  });

  const git = (root: string, args: ReadonlyArray<string>, timeout = Duration.seconds(30)) =>
    runner
      .run({
        command: "git",
        args: ["-C", root, ...args],
        timeout,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(Effect.mapError(() => failed("Ozone could not run git.")));

  /** Where Dokploy clones from: the branch's remote, pushed up to the commit. */
  const publish = Effect.fn("DokployDeploy.publish")(function* (
    root: string,
    commitSha: string,
    note: DokployDeployInput["note"],
  ) {
    const branch = (yield* git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])).stdout.trim();
    if (branch.length === 0) {
      return yield* failed("The app is not on a branch, so Dokploy has nothing to clone.");
    }
    const configured = (yield* git(root, ["config", `branch.${branch}.remote`])).stdout.trim();
    const remote = configured.length > 0 ? configured : "origin";
    const url = (yield* git(root, ["remote", "get-url", remote])).stdout.trim();
    if (url.length === 0 || !cloneableUrl(url)) {
      return yield* failed(
        "Dokploy builds the app from a Git remote it can clone, and this app has none. Add one, such as a GitHub repository, as its origin, then deploy again.",
      );
    }
    yield* note(`$ git push ${remote} ${commitSha.slice(0, 7)}:refs/heads/${branch}`);
    const pushed = yield* git(
      root,
      ["push", remote, `${commitSha}:refs/heads/${branch}`],
      Duration.minutes(3),
    );
    const said = `${pushed.stdout}\n${pushed.stderr}`.trim();
    yield* note(said.slice(-4_000));
    if (pushed.code !== 0 || pushed.timedOut) {
      return yield* failed(
        /rejected|non-fast-forward|fetch first/i.test(said)
          ? `${remote} has commits this app does not, so Ozone did not push. Bring them in, then deploy again.\n${said.slice(-1_000)}`
          : `Ozone could not push to ${remote}, which Dokploy clones from. Check that git can push there from this computer.\n${said.slice(-1_000)}`,
      );
    }
    return { branch, url };
  });

  /** The Dokploy service the app runs as, made the first time. */
  const ensureCompose = Effect.fn("DokployDeploy.ensureCompose")(function* (
    access: Dokploy.DokployAccess,
    app: ResolvedApp,
    serverId: string,
  ) {
    const link = yield* readLink(app);
    if (link !== null && link.serverId === serverId) {
      const row = yield* api
        .query(access, "compose.one", { composeId: link.composeId })
        .pipe(Effect.option);
      if (row._tag === "Some") return link;
      // Deleted in Dokploy: a new service, which starts with new volumes.
    }
    const created = yield* api
      .mutate(access, "project.create", {
        name: app.app.name,
        description: "Deployed by Ozone.",
      })
      .pipe(
        Effect.flatMap((body) =>
          decodeCreatedProject(body).pipe(Effect.mapError(malformed("the new project"))),
        ),
      );
    // Dokploy 0.25 put services in environments; before it, in the project.
    const place =
      created.environment !== undefined
        ? { environmentId: created.environment.environmentId }
        : { projectId: created.project?.projectId ?? created.projectId ?? "" };
    const compose = yield* api
      .mutate(access, "compose.create", {
        name: app.app.name,
        description: "",
        composeType: "docker-compose",
        appName: `ozone-${app.app.slug}`.slice(0, 63),
        ...place,
      })
      .pipe(
        Effect.flatMap((body) =>
          decodeComposeRow(body).pipe(Effect.mapError(malformed("the new service"))),
        ),
      );
    const next: Link = {
      serverId,
      composeId: compose.composeId,
      appName: compose.appName,
      mountId: null,
      domainId: null,
      domain: null,
    };
    yield* writeLink(app, next);
    return next;
  });

  const latestDeployment = (access: Dokploy.DokployAccess, composeId: string) =>
    api.query(access, "deployment.allByCompose", { composeId }).pipe(
      Effect.flatMap((body) =>
        decodeDeployments(body).pipe(Effect.mapError(malformed("its deployments"))),
      ),
      Effect.map(
        (rows) =>
          [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null,
      ),
    );

  return DokployDeploy.of({
    deploy: Effect.fn("DokployDeploy.deploy")(function* (input) {
      const { app, target } = input;
      const access = yield* saved.dokploy(target.dokploy);
      yield* input.step("Pushing the commit for Dokploy to clone.");
      const source = yield* publish(app.workspaceRoot, input.commitSha, input.note);

      const url =
        target.domain !== null
          ? `https://${target.domain}`
          : (target.publicUrl ?? `http://${new URL(access.url).hostname}:${input.port}`);
      const override = input.overrideFor(url);
      yield* input.step(`Preparing the app on ${access.name}.`);
      let link = yield* ensureCompose(access, app, target.dokploy);
      yield* api.mutate(access, "compose.update", {
        composeId: link.composeId,
        sourceType: "git",
        customGitUrl: source.url,
        customGitBranch: source.branch,
        composePath: `./${PROD_COMPOSE_FILE}`,
        command: dokployCommand({
          appName: link.appName,
          appService: app.manifest.runtime.appService,
          databaseService: input.databaseService,
          migrates: input.migrates,
        }),
        env: dokployEnv({ port: input.port, domain: target.domain }),
        createEnvFile: true,
      });
      if (link.mountId === null) {
        const mount = yield* api
          .mutate(access, "mounts.create", {
            type: "file",
            serviceId: link.composeId,
            serviceType: "compose",
            filePath: OVERRIDE_FILE,
            mountPath: `/ozone/${OVERRIDE_FILE}`,
            content: override,
          })
          .pipe(
            Effect.flatMap((body) =>
              decodeMount(body).pipe(Effect.mapError(malformed("the settings file"))),
            ),
          );
        link = { ...link, mountId: mount.mountId };
        yield* writeLink(app, link);
      } else {
        yield* api.mutate(access, "mounts.update", {
          mountId: link.mountId,
          content: override,
        });
      }
      if (link.domain !== target.domain) {
        if (link.domainId !== null) {
          yield* api
            .mutate(access, "domain.delete", { domainId: link.domainId })
            .pipe(Effect.ignore);
        }
        const domainId =
          target.domain === null
            ? null
            : (yield* api
                .mutate(access, "domain.create", {
                  host: target.domain,
                  path: "/",
                  port: app.manifest.runtime.appPort,
                  https: true,
                  certificateType: "letsencrypt",
                  customCertResolver: "",
                  composeId: link.composeId,
                  serviceName: app.manifest.runtime.appService,
                  domainType: "compose",
                })
                .pipe(
                  Effect.flatMap((body) =>
                    decodeDomain(body).pipe(Effect.mapError(malformed("the domain"))),
                  ),
                )).domainId;
        link = { ...link, domainId, domain: target.domain };
        yield* writeLink(app, link);
      }

      const before = yield* latestDeployment(access, link.composeId);
      yield* input.step(`${access.name} is building and starting the app.`);
      yield* api.mutate(access, "compose.deploy", {
        composeId: link.composeId,
        title: (input.title ?? `Commit ${input.commitSha.slice(0, 7)}`).slice(0, 200),
        description: input.commitSha,
      });
      // Dokploy queues the deploy; its row appears, runs, then settles.
      const settled = yield* latestDeployment(access, link.composeId).pipe(
        Effect.filterOrFail(
          (latest): latest is Deployment =>
            latest !== null &&
            latest.deploymentId !== before?.deploymentId &&
            (latest.status === "done" ||
              latest.status === "error" ||
              latest.status === "cancelled"),
          () => "waiting" as const,
        ),
        Effect.retry({
          schedule: Schedule.spaced(Duration.seconds(3)),
          while: (error) => error === "waiting",
        }),
        Effect.timeoutOption(DEPLOY_TIMEOUT),
        Effect.mapError((error) =>
          error === "waiting" ? failed("Dokploy did not answer.") : error,
        ),
      );
      if (settled._tag === "None") {
        return yield* failed(
          `${access.name} did not finish the deploy in time. Its log is in Dokploy.`,
        );
      }
      const log = yield* api
        .query(access, "deployment.readLogs", {
          deploymentId: settled.value.deploymentId,
          tail: "400",
        })
        .pipe(
          Effect.map((text) => (typeof text === "string" ? text : "")),
          Effect.orElseSucceed(() => ""),
        );
      yield* input.note(log.slice(-6_000));
      if (settled.value.status !== "done") {
        return {
          ok: false as const,
          log: log.length > 0 ? log : "Dokploy reports the deploy failed. Its log is in Dokploy.",
        };
      }
      return { ok: true as const, url };
    }),
    state: Effect.fn("DokployDeploy.state")(function* (app, serverId) {
      const { link, access } = yield* linked(app, serverId);
      const row = yield* api
        .query(access, "compose.one", { composeId: link.composeId })
        .pipe(
          Effect.flatMap((body) =>
            decodeComposeRow(body).pipe(Effect.mapError(malformed("the app's state"))),
          ),
        );
      switch (row.composeStatus) {
        case "running":
          return "deploying" as const;
        case "done":
          return "running" as const;
        case "error":
          return "failed" as const;
        default:
          return "stopped" as const;
      }
    }),
    stop: Effect.fn("DokployDeploy.stop")(function* (app, serverId) {
      const { link, access } = yield* linked(app, serverId);
      yield* api.mutate(access, "compose.stop", { composeId: link.composeId });
    }),
    logs: Effect.fn("DokployDeploy.logs")(function* (app, serverId, service, tail) {
      const { link, access } = yield* linked(app, serverId);
      const containers = yield* api
        .query(access, "docker.getContainersByAppNameMatch", {
          appName: link.appName,
          appType: "docker-compose",
        })
        .pipe(
          Effect.flatMap((body) =>
            decodeContainers(body).pipe(Effect.mapError(malformed("its containers"))),
          ),
        );
      const container = containers.find((entry) => entry.name.includes(`-${service}-`));
      if (container === undefined) return `${service} is not running on ${access.name}.`;
      const text = yield* api.query(access, "compose.readLogs", {
        composeId: link.composeId,
        containerId: container.containerId,
        tail: String(tail),
        since: "all",
      });
      return typeof text === "string" ? text : "";
    }),
  });
});

export const layer = Layer.effect(DokployDeploy, make).pipe(Layer.provide(ProcessRunner.layer));
