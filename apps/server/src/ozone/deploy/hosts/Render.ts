import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";
import * as Schema from "effect/Schema";

import { githubRepoOf } from "../gitPublish.ts";
import type { HostDriver, HostIds, HostState } from "./HostDriver.ts";
import { failed, hostHttp, reading, untilSettled } from "./hostHttp.ts";

const LABEL = "Render";
const read = <S extends Schema.Top>(schema: S, what: string) => reading(schema, LABEL, what);

const Message = Schema.Struct({ message: Schema.optionalKey(Schema.String) });
const decodeMessage = Schema.decodeUnknownOption(Message);
const Owners = Schema.Array(Schema.Struct({ owner: Schema.Struct({ id: Schema.String }) }));
const Postgres = Schema.Struct({ id: Schema.String, status: Schema.String });
const Connection = Schema.Struct({
  internalConnectionString: Schema.String,
  externalConnectionString: Schema.String,
});
const Service = Schema.Struct({
  id: Schema.String,
  suspended: Schema.optionalKey(Schema.String),
  serviceDetails: Schema.Struct({ url: Schema.String }),
});
const Created = Schema.Struct({ service: Service });
const Deploy = Schema.Struct({ id: Schema.String, status: Schema.String });
const Deploys = Schema.Array(Schema.Struct({ deploy: Deploy }));
const Logs = Schema.Struct({ logs: Schema.Array(Schema.Struct({ message: Schema.String })) });

const FAILED = new Set(["build_failed", "pre_deploy_failed", "update_failed", "canceled"]);
/** `deactivated` is a deploy a newer one replaced, which only happens to one that went live. */
const LIVE = new Set(["live", "deactivated"]);

/** Render connects from outside only over TLS. */
const withTls = (url: string) =>
  /[?&]sslmode=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;

/**
 * Render: a Docker web service built from the app's repository and a managed Postgres. Its free
 * web service sleeps when idle, and its free database is deleted by Render after about a month.
 */
export const makeRender = (http: HttpClient.HttpClient): HostDriver => {
  const call = hostHttp({
    http,
    label: LABEL,
    baseUrl: "https://api.render.com/v1",
    tokenHelp: "Make an API key under Account Settings → API Keys.",
    said: (body) => {
      const decoded = decodeMessage(body);
      return decoded._tag === "Some" ? (decoded.value.message ?? null) : null;
    },
    explain: (refusal, request) =>
      refusal.status === 402
        ? `${LABEL} wants payment details on the account before it can ${request.what}. Add them in Render, then deploy again.`
        : null,
  });

  const ownerOf = (token: string) =>
    call(token, {
      method: "GET",
      path: "/owners",
      query: { limit: "1" },
      what: "read the account",
    }).pipe(
      Effect.flatMap(read(Owners, "the account")),
      Effect.flatMap(([first]) =>
        first === undefined
          ? Effect.fail(failed(`${LABEL} has no workspace for that key.`))
          : Effect.succeed(first.owner.id),
      ),
    );
  const serviceOf = (token: string, serviceId: string) =>
    call(token, { method: "GET", path: `/services/${serviceId}`, what: "read the app" }).pipe(
      Effect.flatMap(read(Service, "the app")),
    );
  const latestDeploy = (token: string, serviceId: string) =>
    call(token, {
      method: "GET",
      path: `/services/${serviceId}/deploys`,
      query: { limit: "1" },
      what: "read the app's deploys",
    }).pipe(
      Effect.flatMap(read(Deploys, "the app's deploys")),
      Effect.map(([first]) => first?.deploy ?? null),
    );
  const logsOf = (token: string, ids: HostIds, type: "app" | "build", tail: number) =>
    call(token, {
      method: "GET",
      path: "/logs",
      query: {
        ownerId: ids.ownerId ?? "",
        resource: ids.serviceId ?? "",
        type,
        direction: "backward",
        limit: String(Math.min(Math.max(tail, 1), 100)),
      },
      what: "read the logs",
    }).pipe(
      Effect.flatMap(read(Logs, "the logs")),
      Effect.map(({ logs }) =>
        logs
          .map((line) => line.message)
          .toReversed()
          .join("\n"),
      ),
    );

  return {
    label: LABEL,
    clones: true,
    keepsData: true,
    verify: (token) => Effect.asVoid(ownerOf(token)),
    ensure: Effect.fn("Render.ensure")(function* ({ app, ids: known, note, save, source, token }) {
      let ids = known;
      const keep = (more: HostIds) => {
        ids = { ...ids, ...more };
        return save(ids);
      };
      if (source.remote === null) return yield* failed(`${LABEL} needs a Git remote.`);
      if (ids.ownerId === undefined) yield* keep({ ownerId: yield* ownerOf(token) });
      const ownerId = ids.ownerId ?? "";

      let database = null;
      if (app.database !== null) {
        if (ids.postgresId === undefined) {
          yield* note(`Creating a free Postgres database on ${LABEL}.`);
          const created = yield* call(token, {
            method: "POST",
            path: "/postgres",
            body: {
              name: `${app.slug}-db`,
              ownerId,
              plan: "free",
              version: "17",
              databaseName: app.database.database,
              databaseUser: app.database.user,
            },
            what: "create the database",
          }).pipe(Effect.flatMap(read(Postgres, "the new database")));
          yield* keep({ postgresId: created.id });
        }
        const postgresId = ids.postgresId ?? "";
        const ready = yield* untilSettled(
          call(token, {
            method: "GET",
            path: `/postgres/${postgresId}`,
            what: "read the database",
          }).pipe(Effect.flatMap(read(Postgres, "the database"))),
          (row) => (row.status === "available" ? row : null),
          Duration.minutes(10),
        );
        if (ready._tag === "None") {
          return yield* failed(
            `The database on ${LABEL} is not available. Render deletes a free database after about a month; check it in Render.`,
          );
        }
        const connection = yield* call(token, {
          method: "GET",
          path: `/postgres/${postgresId}/connection-info`,
          what: "read the database's address",
        }).pipe(Effect.flatMap(read(Connection, "the database's address")));
        database = {
          internal: connection.internalConnectionString,
          external: withTls(connection.externalConnectionString),
        };
      }

      if (ids.serviceId === undefined) {
        const repo = githubRepoOf(source.remote.url);
        const created = yield* call(token, {
          method: "POST",
          path: "/services",
          body: {
            type: "web_service",
            name: app.slug,
            ownerId,
            repo: repo === null ? source.remote.url : `https://github.com/${repo}`,
            branch: source.remote.branch,
            // Ozone starts each deploy itself, for the commit it was asked to deploy.
            autoDeployTrigger: "off",
            serviceDetails: {
              runtime: "docker",
              plan: "free",
              healthCheckPath: app.healthPath,
              envSpecificDetails: { dockerfilePath: "./Dockerfile" },
            },
          },
          what: `create the app from ${source.remote.url}. If the repository is private, connect its Git provider to Render first`,
        }).pipe(Effect.flatMap(read(Created, "the new app")));
        yield* keep({ serviceId: created.service.id });
        return { ids, url: created.service.serviceDetails.url, database };
      }
      const service = yield* serviceOf(token, ids.serviceId);
      return { ids, url: service.serviceDetails.url, database };
    }),
    release: Effect.fn("Render.release")(function* ({ env, note, place, source, token }) {
      const serviceId = place.ids.serviceId ?? "";
      const path = `/services/${serviceId}`;
      // A stopped app has to be let run again before Render deploys it.
      yield* call(token, { method: "POST", path: `${path}/resume`, what: "resume the app" }).pipe(
        Effect.ignore,
      );
      yield* call(token, {
        method: "PUT",
        path: `${path}/env-vars`,
        body: [...env].map(([key, value]) => ({ key, value })),
        what: "set the app's variables",
      });
      const before = yield* latestDeploy(token, serviceId);
      yield* call(token, {
        method: "POST",
        path: `${path}/deploys`,
        body: { commitId: source.commitSha },
        what: "start the deploy",
      });
      // Render may queue the deploy and answer without it, so the newest one is looked up.
      const settled = yield* untilSettled(latestDeploy(token, serviceId), (latest) =>
        latest !== null &&
        latest.id !== before?.id &&
        (LIVE.has(latest.status) || FAILED.has(latest.status))
          ? latest
          : null,
      );
      if (settled._tag === "None") {
        return { ok: false as const, log: `${LABEL} did not finish the deploy in time.` };
      }
      if (LIVE.has(settled.value.status)) return { ok: true as const };
      const log = yield* logsOf(token, place.ids, "build", 100).pipe(
        Effect.orElseSucceed(() => ""),
      );
      yield* note(log);
      return {
        ok: false as const,
        log: log.length > 0 ? log : `${LABEL} reports the deploy as ${settled.value.status}.`,
      };
    }),
    state: Effect.fn("Render.state")(function* (token, ids) {
      const service = yield* serviceOf(token, ids.serviceId ?? "");
      if (service.suspended === "suspended") return "stopped" satisfies HostState;
      const latest = yield* latestDeploy(token, service.id);
      if (latest === null) return "stopped" satisfies HostState;
      if (LIVE.has(latest.status)) return "running" satisfies HostState;
      return FAILED.has(latest.status)
        ? ("failed" satisfies HostState)
        : ("deploying" satisfies HostState);
    }),
    stop: (token, ids) =>
      Effect.asVoid(
        call(token, {
          method: "POST",
          path: `/services/${ids.serviceId ?? ""}/suspend`,
          what: "stop the app",
        }),
      ),
    logs: (token, ids, tail) => logsOf(token, ids, "app", tail),
  };
};
