import type { OzoneAppError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";
import * as Schema from "effect/Schema";

import { githubRepoOf } from "../gitPublish.ts";
import { failed } from "../../errors.ts";
import type { HostDriver, HostIds, HostState } from "./HostDriver.ts";
import { hostHttp, reading, untilSettled } from "./hostHttp.ts";

const LABEL = "Railway";
const TOKEN_HELP =
  "Make an account token under Account Settings → Tokens, with no workspace chosen.";
/** The image and mount of Railway's own Postgres template. */
const POSTGRES_IMAGE = "ghcr.io/railwayapp-templates/postgres-ssl:18";
const POSTGRES_MOUNT = "/var/lib/postgresql/data";
const read = <S extends Schema.Top>(schema: S, what: string) => reading(schema, LABEL, what);

const Envelope = Schema.Struct({
  data: Schema.optionalKey(Schema.Unknown),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
const Id = Schema.Struct({ id: Schema.String });
const Me = Schema.Struct({
  me: Schema.Struct({ workspaces: Schema.Array(Id) }),
});
const Project = Schema.Struct({
  projectCreate: Schema.Struct({
    id: Schema.String,
    environments: Schema.Struct({ edges: Schema.Array(Schema.Struct({ node: Id })) }),
  }),
});
const ServiceCreated = Schema.Struct({ serviceCreate: Id });
const Proxy = Schema.Struct({
  tcpProxyCreate: Schema.Struct({ domain: Schema.String, proxyPort: Schema.Number }),
});
const Domain = Schema.Struct({ serviceDomainCreate: Schema.Struct({ domain: Schema.String }) });
const Started = Schema.Struct({ serviceInstanceDeployV2: Schema.String });
const DeploymentRow = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  deploymentStopped: Schema.optionalKey(Schema.Boolean),
});
const OneDeployment = Schema.Struct({ deployment: DeploymentRow });
const Deployments = Schema.Struct({
  deployments: Schema.Struct({ edges: Schema.Array(Schema.Struct({ node: DeploymentRow })) }),
});
const LogLines = Schema.Array(Schema.Struct({ message: Schema.String }));
const BuildLogs = Schema.Struct({ buildLogs: LogLines });
const RunLogs = Schema.Struct({ deploymentLogs: LogLines });

const RUNNING = new Set(["SUCCESS", "SLEEPING"]);
const FAILED = new Set(["FAILED", "CRASHED", "REMOVED", "SKIPPED"]);

/**
 * Railway: a service built from the app's GitHub repository, and a Postgres service with a volume
 * that Ozone sets up as Railway's own template does. Railway is a trial credit, not a free plan.
 */
export const makeRailway = (
  http: HttpClient.HttpClient,
  newSecret: Effect.Effect<string>,
): HostDriver => {
  const call = hostHttp({
    http,
    label: LABEL,
    baseUrl: "https://backboard.railway.com",
    tokenHelp: TOKEN_HELP,
    said: () => null,
  });
  /** One GraphQL operation. Railway answers 200 with `errors` when it refuses. */
  const gql = Effect.fn("Railway.gql")(function* (
    token: string,
    what: string,
    query: string,
    variables: Readonly<Record<string, unknown>> = {},
  ): Effect.fn.Return<unknown, OzoneAppError> {
    const body = yield* call(token, {
      method: "POST",
      path: "/graphql/v2",
      body: { query, variables },
      what,
    }).pipe(Effect.flatMap(read(Envelope, "a request")));
    const refused = body.errors?.[0]?.message;
    if (refused === undefined) return body.data;
    return yield* failed(
      /not authorized/i.test(refused)
        ? `${LABEL} refused the token. ${TOKEN_HELP}`
        : `${LABEL} could not ${what}: ${refused}`,
    );
  });

  const latestDeployment = (token: string, ids: HostIds, serviceId: string) =>
    gql(
      token,
      "read the app's deploys",
      `query ($input: DeploymentListInput!) {
        deployments(input: $input, first: 1) { edges { node { id status deploymentStopped } } }
      }`,
      { input: { projectId: ids.projectId, environmentId: ids.environmentId, serviceId } },
    ).pipe(
      Effect.flatMap(read(Deployments, "the app's deploys")),
      Effect.map((body) => body.deployments.edges[0]?.node ?? null),
    );
  const text = (lines: typeof LogLines.Type) => lines.map((line) => line.message).join("\n");
  const runLogs = (token: string, deploymentId: string, tail: number) =>
    gql(
      token,
      "read the logs",
      `query ($id: String!, $limit: Int) { deploymentLogs(deploymentId: $id, limit: $limit) { message } }`,
      { id: deploymentId, limit: tail },
    ).pipe(
      Effect.flatMap(read(RunLogs, "the logs")),
      Effect.map((body) => text(body.deploymentLogs)),
    );
  const setVariables = (
    token: string,
    ids: HostIds,
    serviceId: string,
    variables: Readonly<Record<string, string>>,
  ) =>
    gql(
      token,
      "set the variables",
      `mutation ($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      {
        input: {
          projectId: ids.projectId,
          environmentId: ids.environmentId,
          serviceId,
          variables,
          // Ozone starts the deploy itself once everything is set.
          skipDeploys: true,
        },
      },
    );

  return {
    label: LABEL,
    clones: true,
    keepsData: true,
    verify: (token) =>
      Effect.asVoid(
        gql(token, "read the account", "query { me { workspaces { id } } }").pipe(
          Effect.flatMap(read(Me, "the account")),
        ),
      ),
    ensure: Effect.fn("Railway.ensure")(function* ({ app, ids: known, note, save, source, token }) {
      let ids = known;
      const keep = (more: HostIds) => {
        ids = { ...ids, ...more };
        return save(ids);
      };
      const repository = source.remote === null ? null : githubRepoOf(source.remote.url);
      if (source.remote === null || repository === null) {
        return yield* failed(
          `${LABEL} builds from a GitHub repository, and this app's remote is not one. Push the app to GitHub and connect GitHub to Railway.`,
        );
      }
      if (ids.projectId === undefined) {
        const me = yield* gql(token, "read the account", "query { me { workspaces { id } } }").pipe(
          Effect.flatMap(read(Me, "the account")),
        );
        const created = yield* gql(
          token,
          "create the project",
          `mutation ($input: ProjectCreateInput!) {
            projectCreate(input: $input) { id environments { edges { node { id } } } }
          }`,
          {
            input: {
              name: app.name,
              description: "Deployed by Ozone.",
              workspaceId: me.me.workspaces[0]?.id,
            },
          },
        ).pipe(Effect.flatMap(read(Project, "the new project")));
        const environmentId = created.projectCreate.environments.edges[0]?.node.id;
        if (environmentId === undefined) {
          return yield* failed(`${LABEL} made a project with no environment to deploy to.`);
        }
        yield* keep({ projectId: created.projectCreate.id, environmentId });
      }
      const place = { projectId: ids.projectId, environmentId: ids.environmentId };

      let database = null;
      if (app.database !== null) {
        const { database: name, user } = app.database;
        if (ids.databaseId === undefined) {
          yield* note(`Creating a Postgres database on ${LABEL}.`);
          const password = yield* newSecret;
          const created = yield* gql(
            token,
            "create the database",
            `mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
            {
              input: {
                projectId: ids.projectId,
                name: "Postgres",
                source: { image: POSTGRES_IMAGE },
                variables: {
                  POSTGRES_USER: user,
                  POSTGRES_DB: name,
                  POSTGRES_PASSWORD: password,
                  PGDATA: `${POSTGRES_MOUNT}/pgdata`,
                },
              },
            },
          ).pipe(Effect.flatMap(read(ServiceCreated, "the new database")));
          // The password is kept with the id: the database is created with it and keeps it.
          yield* keep({ databaseId: created.serviceCreate.id, databasePassword: password });
        }
        const serviceId = ids.databaseId ?? "";
        if (ids.databaseVolume === undefined) {
          yield* gql(
            token,
            "give the database a volume",
            `mutation ($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`,
            { input: { ...place, serviceId, mountPath: POSTGRES_MOUNT } },
          );
          yield* keep({ databaseVolume: "made" });
        }
        if (ids.databaseHost === undefined) {
          const proxy = yield* gql(
            token,
            "open the database to this computer",
            `mutation ($input: TCPProxyCreateInput!) {
              tcpProxyCreate(input: $input) { domain proxyPort }
            }`,
            { input: { serviceId, environmentId: ids.environmentId, applicationPort: 5432 } },
          ).pipe(Effect.flatMap(read(Proxy, "the database's address")));
          yield* keep({
            databaseHost: `${proxy.tcpProxyCreate.domain}:${proxy.tcpProxyCreate.proxyPort}`,
          });
          // The volume and the proxy take effect on the database's next start.
          yield* gql(
            token,
            "restart the database",
            `mutation ($serviceId: String!, $environmentId: String!) {
              serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
            }`,
            { serviceId, environmentId: ids.environmentId },
          );
        }
        const ready = yield* untilSettled(
          latestDeployment(token, ids, serviceId),
          (latest) => (latest !== null && RUNNING.has(latest.status) ? latest : null),
          Duration.minutes(10),
        );
        if (ready._tag === "None") {
          return yield* failed(`The database on ${LABEL} did not start. Check it in Railway.`);
        }
        const login = `${user}:${encodeURIComponent(ids.databasePassword ?? "")}`;
        database = {
          // Railway fills in the database's private name where the app runs.
          internal: `postgresql://${login}@\${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${name}`,
          external: `postgresql://${login}@${ids.databaseHost ?? ""}/${name}`,
        };
      }

      if (ids.serviceId === undefined) {
        const created = yield* gql(
          token,
          `create the service from ${repository}. Connect GitHub to Railway and give it that repository first`,
          `mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
          {
            input: {
              projectId: ids.projectId,
              name: app.slug,
              source: { repo: repository },
              branch: source.remote.branch,
            },
          },
        ).pipe(Effect.flatMap(read(ServiceCreated, "the new service")));
        yield* keep({ serviceId: created.serviceCreate.id });
      }
      const serviceId = ids.serviceId ?? "";
      if (ids.domain === undefined) {
        const domain = yield* gql(
          token,
          "give the app an address",
          `mutation ($input: ServiceDomainCreateInput!) {
            serviceDomainCreate(input: $input) { domain }
          }`,
          { input: { serviceId, environmentId: ids.environmentId, targetPort: app.port } },
        ).pipe(Effect.flatMap(read(Domain, "the app's address")));
        yield* gql(
          token,
          "set the health check",
          `mutation ($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
            serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
          }`,
          {
            serviceId,
            environmentId: ids.environmentId,
            input: { healthcheckPath: app.healthPath },
          },
        );
        yield* keep({ domain: domain.serviceDomainCreate.domain });
      }
      return { ids, url: `https://${ids.domain ?? ""}`, database };
    }),
    release: Effect.fn("Railway.release")(function* ({ env, note, place, source, token }) {
      const { ids } = place;
      const serviceId = ids.serviceId ?? "";
      yield* setVariables(token, ids, serviceId, Object.fromEntries(env));
      const started = yield* gql(
        token,
        "start the deploy",
        `mutation ($serviceId: String!, $environmentId: String!, $commitSha: String) {
          serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
        }`,
        { serviceId, environmentId: ids.environmentId, commitSha: source.commitSha },
      ).pipe(Effect.flatMap(read(Started, "the deploy")));
      const deploymentId = started.serviceInstanceDeployV2;
      const settled = yield* untilSettled(
        gql(
          token,
          "read the deploy",
          `query ($id: String!) { deployment(id: $id) { id status } }`,
          {
            id: deploymentId,
          },
        ).pipe(Effect.flatMap(read(OneDeployment, "the deploy"))),
        ({ deployment }) =>
          RUNNING.has(deployment.status) || FAILED.has(deployment.status)
            ? deployment.status
            : null,
      );
      if (settled._tag === "None") {
        return { ok: false as const, log: `${LABEL} did not finish the deploy in time.` };
      }
      if (RUNNING.has(settled.value)) return { ok: true as const };
      const build = yield* gql(
        token,
        "read the build's log",
        `query ($id: String!) { buildLogs(deploymentId: $id, limit: 300) { message } }`,
        { id: deploymentId },
      ).pipe(
        Effect.flatMap(read(BuildLogs, "the build's log")),
        Effect.map((body) => text(body.buildLogs)),
        Effect.orElseSucceed(() => ""),
      );
      const run = yield* runLogs(token, deploymentId, 100).pipe(Effect.orElseSucceed(() => ""));
      const log = `${build}\n${run}`.trim();
      yield* note(log);
      return {
        ok: false as const,
        log: log.length > 0 ? log : `${LABEL} reports the deploy as ${settled.value}.`,
      };
    }),
    state: Effect.fn("Railway.state")(function* (token, ids) {
      const latest = yield* latestDeployment(token, ids, ids.serviceId ?? "");
      if (latest === null || latest.deploymentStopped === true) {
        return "stopped" satisfies HostState;
      }
      if (RUNNING.has(latest.status)) return "running" satisfies HostState;
      if (latest.status === "REMOVED" || latest.status === "SKIPPED") {
        return "stopped" satisfies HostState;
      }
      return FAILED.has(latest.status)
        ? ("failed" satisfies HostState)
        : ("deploying" satisfies HostState);
    }),
    stop: Effect.fn("Railway.stop")(function* (token, ids) {
      const latest = yield* latestDeployment(token, ids, ids.serviceId ?? "");
      if (latest === null) return;
      // Stops the running deploy; the service, its variables and the database stay.
      yield* gql(token, "stop the app", `mutation ($id: String!) { deploymentStop(id: $id) }`, {
        id: latest.id,
      });
    }),
    logs: Effect.fn("Railway.logs")(function* (token, ids, tail) {
      const latest = yield* latestDeployment(token, ids, ids.serviceId ?? "");
      return latest === null ? "" : yield* runLogs(token, latest.id, tail);
    }),
  };
};
