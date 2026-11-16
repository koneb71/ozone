// @effect-diagnostics nodeBuiltinImport:off - Vercel names an uploaded file by its SHA-1.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type { HttpClient } from "effect/http";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { failed } from "../../errors.ts";
import type { HostDriver, HostIds, HostState } from "./HostDriver.ts";
import { hostHttp, reading, untilSettled } from "./hostHttp.ts";

const LABEL = "Vercel";
const TOKEN_HELP = "Make a token under Account Settings → Tokens.";
const read = <S extends Schema.Top>(schema: S, what: string) => reading(schema, LABEL, what);

const Refusal = Schema.Struct({
  error: Schema.optionalKey(
    Schema.Struct({
      message: Schema.optionalKey(Schema.String),
      invalidToken: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
const decodeRefusal = Schema.decodeUnknownOption(Refusal);
const User = Schema.Struct({
  user: Schema.Struct({ defaultTeamId: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
});
const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  paused: Schema.optionalKey(Schema.Boolean),
  targets: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        production: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              id: Schema.optionalKey(Schema.String),
              readyState: Schema.optionalKey(Schema.String),
              alias: Schema.optionalKey(Schema.Array(Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
});
const Deployment = Schema.Struct({
  id: Schema.String,
  readyState: Schema.String,
  alias: Schema.optionalKey(Schema.Array(Schema.String)),
  aliasAssigned: Schema.optionalKey(Schema.Unknown),
  errorMessage: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const Events = Schema.Array(
  Schema.Struct({
    text: Schema.optionalKey(Schema.String),
    payload: Schema.optionalKey(Schema.Struct({ text: Schema.optionalKey(Schema.String) })),
  }),
);
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
);

const decodeManifest = Schema.decodeUnknownEffect(Manifest);

const FAILED = new Set(["ERROR", "CANCELED", "BLOCKED"]);

/**
 * Vercel: builds the commit's files, uploaded from this machine, with the framework's own build.
 * It runs no Docker image and no database, so it is only for an app that keeps no data.
 */
export const makeVercel = (
  http: HttpClient.HttpClient,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): HostDriver => {
  const call = hostHttp({
    http,
    label: LABEL,
    baseUrl: "https://api.vercel.com",
    tokenHelp: TOKEN_HELP,
    said: (body) => {
      const decoded = decodeRefusal(body);
      return decoded._tag === "Some" ? (decoded.value.error?.message ?? null) : null;
    },
    // Vercel answers a token it does not know with 403, not 401.
    explain: (refusal) => {
      const decoded = decodeRefusal(refusal.body);
      return decoded._tag === "Some" && decoded.value.error?.invalidToken === true
        ? `${LABEL} refused the token. ${TOKEN_HELP}`
        : null;
    },
  });
  const scope = (ids: HostIds): Record<string, string> =>
    ids.teamId === undefined ? {} : { teamId: ids.teamId };
  const projectOf = (token: string, ids: HostIds, idOrName: string) =>
    call(token, {
      method: "GET",
      path: `/v9/projects/${encodeURIComponent(idOrName)}`,
      query: scope(ids),
      what: "read the project",
    }).pipe(Effect.flatMap(read(Project, "the project")));
  const eventsOf = (token: string, ids: HostIds, deploymentId: string, tail: number) =>
    call(token, {
      method: "GET",
      path: `/v3/deployments/${deploymentId}/events`,
      query: {
        ...scope(ids),
        builds: "1",
        limit: String(tail),
        direction: "backward",
        follow: "0",
      },
      what: "read the build's log",
    }).pipe(
      Effect.flatMap(read(Events, "the build's log")),
      Effect.map((events) =>
        events
          .map((event) => event.text ?? event.payload?.text ?? "")
          .filter((line) => line.length > 0)
          .toReversed()
          .join("\n"),
      ),
    );

  /** Uploads every file of the commit, and lists them as a deployment names them. */
  const upload = Effect.fn("Vercel.upload")(function* (token: string, ids: HostIds, root: string) {
    const entries = yield* fs
      .readDirectory(root, { recursive: true })
      .pipe(Effect.mapError(() => failed("Ozone could not read the commit's files.")));
    const files = yield* Effect.forEach(
      entries,
      Effect.fn("Vercel.uploadFile")(function* (entry) {
        const file = path.join(root, entry);
        const stat = yield* fs.stat(file).pipe(Effect.option);
        if (stat._tag === "None" || stat.value.type !== "File") return null;
        const bytes = yield* fs
          .readFile(file)
          .pipe(Effect.mapError(() => failed(`Ozone could not read ${entry}.`)));
        const sha = NodeCrypto.createHash("sha1").update(bytes).digest("hex");
        yield* call(token, {
          method: "POST",
          path: "/v2/files",
          query: scope(ids),
          bytes,
          headers: { "x-vercel-digest": sha },
          what: `upload ${entry}`,
        });
        return { file: entry.split(path.sep).join("/"), sha, size: bytes.length };
      }),
      { concurrency: 8 },
    );
    return files.filter((file) => file !== null);
  });

  return {
    label: LABEL,
    clones: false,
    keepsData: false,
    verify: (token) =>
      Effect.asVoid(
        call(token, { method: "GET", path: "/v2/user", what: "read the account" }).pipe(
          Effect.flatMap(read(User, "the account")),
        ),
      ),
    ensure: Effect.fn("Vercel.ensure")(function* ({ app, ids: known, save, token }) {
      let ids = known;
      const keep = (more: HostIds) => {
        ids = { ...ids, ...more };
        return save(ids);
      };
      if (ids.projectId === undefined) {
        const user = yield* call(token, {
          method: "GET",
          path: "/v2/user",
          what: "read the account",
        }).pipe(Effect.flatMap(read(User, "the account")));
        const teamId = user.user.defaultTeamId ?? null;
        if (teamId !== null) ids = { ...ids, teamId };
        const created = yield* call(token, {
          method: "POST",
          path: "/v11/projects",
          query: scope(ids),
          body: { name: app.slug },
          what: "create the project",
        }).pipe(
          Effect.flatMap(read(Project, "the new project")),
          // A project of that name is this account's own, from an earlier deploy.
          Effect.catch(() => projectOf(token, ids, app.slug)),
        );
        yield* keep({ projectId: created.id, projectName: created.name });
      }
      const project = yield* projectOf(token, ids, ids.projectId ?? "");
      const alias = project.targets?.production?.alias?.[0];
      // Before the first deploy the address is Vercel's to pick; `release` reports the real one.
      return { ids, url: `https://${alias ?? `${project.name}.vercel.app`}`, database: null };
    }),
    release: Effect.fn("Vercel.release")(function* ({ app, env, note, place, source, token }) {
      const { ids } = place;
      const projectId = ids.projectId ?? "";
      yield* call(token, {
        method: "POST",
        path: "/v1/projects/" + projectId + "/unpause",
        query: scope(ids),
        what: "resume the project",
      }).pipe(Effect.ignore);
      if (env.size > 0) {
        yield* call(token, {
          method: "POST",
          path: `/v10/projects/${projectId}/env`,
          query: { ...scope(ids), upsert: "true" },
          body: [...env].map(([key, value]) => ({
            key,
            value,
            type: "encrypted",
            target: ["production"],
          })),
          what: "set the app's variables",
        });
      }
      const root = yield* source.files;
      const manifest = yield* fs.readFileString(path.join(root, "package.json")).pipe(
        Effect.flatMap(decodeManifest),
        Effect.orElseSucceed(() => ({ dependencies: undefined })),
      );
      const framework =
        manifest.dependencies?.["@tanstack/react-start"] === undefined ? null : "tanstack-start";
      yield* note(`Uploading the commit's files to ${LABEL}.`);
      const files = yield* upload(token, ids, root);
      const created = yield* call(token, {
        method: "POST",
        path: "/v13/deployments",
        query: { ...scope(ids), skipAutoDetectionConfirmation: "1" },
        body: {
          name: ids.projectName ?? app.slug,
          project: projectId,
          target: "production",
          files,
          projectSettings: { framework },
        },
        what: "start the deploy",
      }).pipe(Effect.flatMap(read(Deployment, "the deploy")));
      const settled = yield* untilSettled(
        call(token, {
          method: "GET",
          path: `/v13/deployments/${created.id}`,
          query: scope(ids),
          what: "read the deploy",
        }).pipe(Effect.flatMap(read(Deployment, "the deploy"))),
        (deployment) =>
          FAILED.has(deployment.readyState) ||
          (deployment.readyState === "READY" && deployment.aliasAssigned !== false)
            ? deployment
            : null,
      );
      if (settled._tag === "None") {
        return { ok: false as const, log: `${LABEL} did not finish the deploy in time.` };
      }
      const log = yield* eventsOf(token, ids, created.id, 200).pipe(Effect.orElseSucceed(() => ""));
      yield* note(log);
      if (settled.value.readyState !== "READY") {
        return {
          ok: false as const,
          log: [settled.value.errorMessage ?? `${LABEL} reports the deploy failed.`, log]
            .join("\n")
            .trim(),
        };
      }
      const alias = settled.value.alias?.[0];
      return alias === undefined
        ? { ok: true as const }
        : { ok: true as const, url: `https://${alias}` };
    }),
    state: Effect.fn("Vercel.state")(function* (token, ids) {
      const project = yield* projectOf(token, ids, ids.projectId ?? "");
      if (project.paused === true) return "stopped" satisfies HostState;
      const state = project.targets?.production?.readyState;
      if (state === undefined) return "stopped" satisfies HostState;
      if (state === "READY") return "running" satisfies HostState;
      return FAILED.has(state) ? ("failed" satisfies HostState) : ("deploying" satisfies HostState);
    }),
    stop: (token, ids) =>
      Effect.asVoid(
        call(token, {
          method: "POST",
          path: `/v1/projects/${ids.projectId ?? ""}/pause`,
          query: scope(ids),
          what: "stop the app",
        }),
      ),
    logs: Effect.fn("Vercel.logs")(function* (token, ids, tail) {
      const project = yield* projectOf(token, ids, ids.projectId ?? "");
      const deploymentId = project.targets?.production?.id;
      if (deploymentId === undefined) return "";
      // Vercel's API gives the build's output; what the app prints while running is in Vercel.
      return yield* eventsOf(token, ids, deploymentId, tail);
    }),
  };
};
