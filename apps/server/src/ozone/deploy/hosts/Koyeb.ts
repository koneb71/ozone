import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";
import * as Schema from "effect/Schema";

import { githubRepoOf } from "../gitPublish.ts";
import { failed } from "../../errors.ts";
import type { HostApp, HostDriver, HostIds, HostSource, HostState } from "./HostDriver.ts";
import { hostHttp, reading, untilSettled } from "./hostHttp.ts";

const LABEL = "Koyeb";
/** The free instances run in Frankfurt and Washington; the database sits beside the app. */
const REGION = "fra";
const read = <S extends Schema.Top>(schema: S, what: string) => reading(schema, LABEL, what);

const Message = Schema.Struct({ message: Schema.optionalKey(Schema.String) });
const decodeMessage = Schema.decodeUnknownOption(Message);
const App = Schema.Struct({
  app: Schema.Struct({
    id: Schema.String,
    domains: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
  }),
});
const Service = Schema.Struct({
  service: Schema.Struct({
    id: Schema.String,
    status: Schema.optionalKey(Schema.String),
    latest_deployment_id: Schema.optionalKey(Schema.String),
  }),
});
const Deployment = Schema.Struct({
  deployment: Schema.Struct({
    id: Schema.String,
    status: Schema.String,
    database_info: Schema.optionalKey(
      Schema.Struct({
        neon_postgres: Schema.optionalKey(
          Schema.Struct({
            server_host: Schema.optionalKey(Schema.String),
            server_port: Schema.optionalKey(Schema.Number),
            roles: Schema.optionalKey(
              Schema.Array(Schema.Struct({ name: Schema.String, secret_id: Schema.String })),
            ),
          }),
        ),
      }),
    ),
  }),
});
const Revealed = Schema.Struct({ value: Schema.Struct({ password: Schema.String }) });
const Logs = Schema.Struct({ data: Schema.Array(Schema.Struct({ msg: Schema.String })) });

const HEALTHY = new Set(["HEALTHY", "SLEEPING"]);
const FAILED = new Set(["ERROR", "ERRORING", "UNHEALTHY", "DEGRADED", "CANCELED", "STASHED"]);

/** Koyeb: a web service built from the app's GitHub repository and a managed Postgres. */
export const makeKoyeb = (http: HttpClient.HttpClient): HostDriver => {
  const call = hostHttp({
    http,
    label: LABEL,
    baseUrl: "https://app.koyeb.com",
    tokenHelp: "Make an API access token under Organization Settings → API.",
    said: (body) => {
      const decoded = decodeMessage(body);
      return decoded._tag === "Some" ? (decoded.value.message ?? null) : null;
    },
  });

  const serviceOf = (token: string, serviceId: string) =>
    call(token, { method: "GET", path: `/v1/services/${serviceId}`, what: "read the app" }).pipe(
      Effect.flatMap(read(Service, "the app")),
      Effect.map((body) => body.service),
    );
  const deploymentOf = (token: string, deploymentId: string) =>
    call(token, {
      method: "GET",
      path: `/v1/deployments/${deploymentId}`,
      what: "read the deploy",
    }).pipe(
      Effect.flatMap(read(Deployment, "the deploy")),
      Effect.map((body) => body.deployment),
    );
  const logsOf = (
    token: string,
    query: Readonly<Record<string, string>>,
    type: "build" | "runtime",
    tail: number,
  ) =>
    call(token, {
      method: "GET",
      path: "/v1/streams/logs/query",
      query: { ...query, type, order: "desc", limit: String(Math.min(Math.max(tail, 1), 1_000)) },
      what: "read the logs",
    }).pipe(
      Effect.flatMap(read(Logs, "the logs")),
      Effect.map(({ data }) =>
        data
          .map((line) => line.msg)
          .toReversed()
          .join("\n"),
      ),
    );

  /** The web service as Koyeb should run it; every update sends the whole of it. */
  const definition = (
    app: HostApp,
    source: HostSource,
    repository: string,
    env: ReadonlyMap<string, string>,
  ) => ({
    name: "web",
    type: "WEB",
    git: {
      repository: `github.com/${repository}`,
      branch: source.remote?.branch ?? "main",
      sha: source.commitSha,
      docker: { dockerfile: "Dockerfile" },
    },
    instance_types: [{ type: "free" }],
    regions: [REGION],
    ports: [{ port: app.port, protocol: "http" }],
    routes: [{ port: app.port, path: "/" }],
    env: [...env].map(([key, value]) => ({ key, value })),
    health_checks: [{ http: { port: app.port, path: app.healthPath } }],
    scalings: [{ min: 1, max: 1 }],
  });
  const repositoryOf = (source: HostSource) => {
    const repository = source.remote === null ? null : githubRepoOf(source.remote.url);
    return repository === null
      ? Effect.fail(
          failed(
            `${LABEL} builds from a GitHub repository, and this app's remote is not one. Push the app to GitHub and install Koyeb's GitHub app for it.`,
          ),
        )
      : Effect.succeed(repository);
  };

  return {
    label: LABEL,
    clones: true,
    keepsData: true,
    verify: (token) =>
      Effect.asVoid(
        call(token, {
          method: "GET",
          path: "/v1/account/organization",
          what: "read the account",
        }),
      ),
    ensure: Effect.fn("Koyeb.ensure")(function* ({ app, ids: known, note, save, source, token }) {
      let ids = known;
      const keep = (more: HostIds) => {
        ids = { ...ids, ...more };
        return save(ids);
      };
      const repository = yield* repositoryOf(source);
      if (ids.appId === undefined) {
        const created = yield* call(token, {
          method: "POST",
          path: "/v1/apps",
          body: { name: app.slug },
          what: "create the app",
        }).pipe(Effect.flatMap(read(App, "the new app")));
        yield* keep({ appId: created.app.id });
      }
      const appId = ids.appId ?? "";

      let database = null;
      if (app.database !== null) {
        const { database: name, user } = app.database;
        if (ids.databaseId === undefined) {
          yield* note(`Creating a free Postgres database on ${LABEL}.`);
          const created = yield* call(token, {
            method: "POST",
            path: "/v1/services",
            body: {
              app_id: appId,
              definition: {
                name: "db",
                type: "DATABASE",
                database: {
                  neon_postgres: {
                    pg_version: 16,
                    region: REGION,
                    instance_type: "free",
                    // Koyeb keeps the role's password in a secret of this name.
                    roles: [{ name: user, secret: `ozone-${app.slug}-db` }],
                    databases: [{ name, owner: user }],
                  },
                },
              },
            },
            what: "create the database",
          }).pipe(Effect.flatMap(read(Service, "the new database")));
          yield* keep({ databaseId: created.service.id });
        }
        const databaseId = ids.databaseId ?? "";
        const ready = yield* untilSettled(
          serviceOf(token, databaseId).pipe(
            Effect.flatMap((service) => deploymentOf(token, service.latest_deployment_id ?? "")),
          ),
          (deployment) => {
            const info = deployment.database_info?.neon_postgres;
            const role = info?.roles?.find((entry) => entry.name === user);
            return info?.server_host !== undefined && info.server_host !== "" && role !== undefined
              ? { host: info.server_host, port: info.server_port ?? 5432, secretId: role.secret_id }
              : null;
          },
          Duration.minutes(10),
        );
        if (ready._tag === "None") {
          return yield* failed(`The database on ${LABEL} did not become ready. Check it in Koyeb.`);
        }
        const revealed = yield* call(token, {
          method: "POST",
          path: `/v1/secrets/${ready.value.secretId}/reveal`,
          body: {},
          what: "read the database's password",
        }).pipe(Effect.flatMap(read(Revealed, "the database's password")));
        const url = `postgres://${user}:${encodeURIComponent(revealed.value.password)}@${ready.value.host}:${ready.value.port}/${name}?sslmode=require`;
        database = { internal: url, external: url };
      }

      if (ids.serviceId === undefined) {
        const created = yield* call(token, {
          method: "POST",
          path: "/v1/services",
          body: { app_id: appId, definition: definition(app, source, repository, new Map()) },
          what: `create the service from github.com/${repository}. If the repository is private, install Koyeb's GitHub app for it first`,
        }).pipe(Effect.flatMap(read(Service, "the new service")));
        yield* keep({ serviceId: created.service.id });
      }
      const koyebApp = yield* call(token, {
        method: "GET",
        path: `/v1/apps/${appId}`,
        what: "read the app's address",
      }).pipe(Effect.flatMap(read(App, "the app's address")));
      const domain = koyebApp.app.domains?.[0]?.name;
      if (domain === undefined) {
        return yield* failed(`${LABEL} has not given the app an address yet. Deploy again.`);
      }
      return { ids, url: `https://${domain}`, database };
    }),
    release: Effect.fn("Koyeb.release")(function* ({ app, env, note, place, source, token }) {
      const serviceId = place.ids.serviceId ?? "";
      const repository = yield* repositoryOf(source);
      // A paused service takes no update until it is resumed.
      yield* call(token, {
        method: "POST",
        path: `/v1/services/${serviceId}/resume`,
        what: "resume the app",
      }).pipe(Effect.ignore);
      const updated = yield* call(token, {
        method: "PUT",
        path: `/v1/services/${serviceId}`,
        body: { definition: definition(app, source, repository, env) },
        what: "start the deploy",
      }).pipe(Effect.flatMap(read(Service, "the deploy")));
      const deploymentId = updated.service.latest_deployment_id ?? "";
      const settled = yield* untilSettled(deploymentOf(token, deploymentId), (deployment) =>
        HEALTHY.has(deployment.status) || FAILED.has(deployment.status) ? deployment.status : null,
      );
      if (settled._tag === "None") {
        return { ok: false as const, log: `${LABEL} did not finish the deploy in time.` };
      }
      if (HEALTHY.has(settled.value)) return { ok: true as const };
      const log = yield* logsOf(token, { deployment_id: deploymentId }, "build", 200).pipe(
        Effect.orElseSucceed(() => ""),
      );
      yield* note(log);
      return {
        ok: false as const,
        log: log.length > 0 ? log : `${LABEL} reports the deploy as ${settled.value}.`,
      };
    }),
    state: Effect.fn("Koyeb.state")(function* (token, ids) {
      const service = yield* serviceOf(token, ids.serviceId ?? "");
      switch (service.status) {
        case "HEALTHY":
          return "running" satisfies HostState;
        case "STARTING":
        case "RESUMING":
          return "deploying" satisfies HostState;
        case "DEGRADED":
        case "UNHEALTHY":
          return "failed" satisfies HostState;
        default:
          return "stopped" satisfies HostState;
      }
    }),
    stop: (token, ids) =>
      Effect.asVoid(
        call(token, {
          method: "POST",
          path: `/v1/services/${ids.serviceId ?? ""}/pause`,
          what: "stop the app",
        }),
      ),
    logs: (token, ids, tail) => logsOf(token, { service_id: ids.serviceId ?? "" }, "runtime", tail),
  };
};
