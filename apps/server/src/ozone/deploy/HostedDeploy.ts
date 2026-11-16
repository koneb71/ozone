import { OzoneAppError, type OzoneDeployTarget } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import { ENV_FILE_MODE } from "../env/envFile.ts";
import { failed } from "../errors.ts";
import { publishCommit } from "./gitPublish.ts";
import {
  HostDrivers,
  type HostApp,
  type HostIds,
  type HostOutcome,
  type HostState,
} from "./hosts/HostDriver.ts";
import * as SavedServers from "./SavedServers.ts";

export interface HostedDeployInput {
  readonly app: ResolvedApp;
  readonly target: OzoneDeployTarget & { readonly hosted: string };
  readonly commitSha: string;
  /** The app's variables, for the address people reach it at and the database the host made. */
  readonly envFor: (publicUrl: string, databaseUrl: string | null) => ReadonlyMap<string, string>;
  /** Applies the commit's migrations to the host's database, from this machine. Null: none. */
  readonly migrate: ((databaseUrl: string) => Effect.Effect<void, OzoneAppError>) | null;
  /** The commit's files in a folder on this machine. */
  readonly files: Effect.Effect<string, OzoneAppError>;
  readonly note: (text: string) => Effect.Effect<void>;
  readonly step: (doing: string) => Effect.Effect<void>;
}

export type HostedOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly log: string };

/**
 * Deploys an app to a hosting platform with a saved token. The host builds the app's Dockerfile
 * from its Git remote, or from an upload, and runs the database itself. Ozone applies the
 * migrations from this machine first, so one that can lose data is still held back. Nothing here
 * deletes what the host keeps.
 */
export class HostedDeploy extends Context.Service<
  HostedDeploy,
  {
    readonly deploy: (input: HostedDeployInput) => Effect.Effect<HostedOutcome, OzoneAppError>;
    readonly state: (app: ResolvedApp, serverId: string) => Effect.Effect<HostState, OzoneAppError>;
    readonly stop: (app: ResolvedApp, serverId: string) => Effect.Effect<void, OzoneAppError>;
    readonly logs: (
      app: ResolvedApp,
      serverId: string,
      tail: number,
    ) => Effect.Effect<string, OzoneAppError>;
    /** The host's name, for what a person reads about a deploy there. */
    readonly label: (serverId: string) => Effect.Effect<string, OzoneAppError>;
  }
>()("t3/ozone/deploy/HostedDeploy") {}

const Link = Schema.Struct({
  serverId: Schema.String,
  ids: Schema.Record(Schema.String, Schema.String),
});
type Link = typeof Link.Type;
const LinkFile = Schema.fromJsonString(Link);
const decodeLink = Schema.decodeUnknownEffect(LinkFile);
const encodeLink = Schema.encodeEffect(LinkFile);

const hostAppOf = (app: ResolvedApp): HostApp => {
  const postgres = app.manifest.data.services.find((service) => service.kind === "postgres");
  const user = postgres?.user ?? "postgres";
  return {
    name: app.app.name,
    slug: app.app.slug,
    port: app.manifest.runtime.appPort,
    healthPath: app.manifest.runtime.healthPath,
    database: postgres === undefined ? null : { user, database: postgres.database ?? user },
  };
};

const make = Effect.gen(function* () {
  const drivers = yield* HostDrivers;
  const saved = yield* SavedServers.SavedServers;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const linkFileOf = (app: ResolvedApp) =>
    path.join(config.stateDir, "ozone", "apps", app.app.slug, "hosted.json");
  const readLink = (app: ResolvedApp) =>
    fs.readFileString(linkFileOf(app)).pipe(
      Effect.flatMap(decodeLink),
      Effect.map((link): Link | null => link),
      Effect.orElseSucceed(() => null),
    );
  const writeLink = Effect.fn("HostedDeploy.writeLink")(
    function* (app: ResolvedApp, link: Link) {
      yield* fs.makeDirectory(path.dirname(linkFileOf(app)), { recursive: true });
      yield* fs.writeFileString(linkFileOf(app), yield* encodeLink(link), { mode: ENV_FILE_MODE });
    },
    Effect.mapError(() => failed("Ozone could not save where the host runs the app.")),
  );
  const linked = Effect.fn("HostedDeploy.linked")(function* (app: ResolvedApp, serverId: string) {
    const link = yield* readLink(app);
    if (link === null || link.serverId !== serverId) {
      return yield* failed("Ozone has not deployed this app to that hosting account yet.");
    }
    const server = yield* saved.host(serverId);
    return { ids: link.ids, token: server.token, driver: drivers.of(server.provider) };
  });

  return HostedDeploy.of({
    deploy: Effect.fn("HostedDeploy.deploy")(function* (input) {
      const { app, target } = input;
      const server = yield* saved.host(target.hosted);
      const driver = drivers.of(server.provider);
      const hostApp = hostAppOf(app);
      if (hostApp.database !== null && !driver.keepsData) {
        return yield* failed(
          `${driver.label} cannot run this app's database, so Ozone does not deploy it there. Pick another server for an app that keeps data.`,
        );
      }
      const remote = driver.clones
        ? yield* input.step(`Pushing the commit for ${driver.label} to clone.`).pipe(
            Effect.andThen(
              publishCommit({
                runner,
                root: app.workspaceRoot,
                commitSha: input.commitSha,
                builder: driver.label,
                note: input.note,
              }),
            ),
          )
        : null;
      const source = { commitSha: input.commitSha, remote, files: input.files };

      yield* input.step(`Preparing the app on ${driver.label}.`);
      const before = yield* readLink(app);
      // Another account is another place: what it made there is not this one's.
      const known: HostIds = before !== null && before.serverId === target.hosted ? before.ids : {};
      const place = yield* driver.ensure({
        token: server.token,
        app: hostApp,
        source,
        ids: known,
        save: (ids) => writeLink(app, { serverId: target.hosted, ids }),
        note: input.note,
      });
      yield* writeLink(app, { serverId: target.hosted, ids: place.ids });

      if (input.migrate !== null && place.database !== null) {
        yield* input.step(`Applying the migrations to the database on ${driver.label}.`);
        yield* input.migrate(place.database.external);
      }

      yield* input.step(`${driver.label} is building and starting the app.`);
      const env = new Map(input.envFor(place.url, place.database?.internal ?? null));
      // Hosts route to the port the app says it listens on.
      env.set("PORT", String(hostApp.port));
      const outcome: HostOutcome = yield* driver.release({
        token: server.token,
        app: hostApp,
        source,
        place,
        env,
        note: input.note,
      });
      return outcome.ok ? { ok: true as const, url: outcome.url ?? place.url } : outcome;
    }),
    state: Effect.fn("HostedDeploy.state")(function* (app, serverId) {
      const { driver, ids, token } = yield* linked(app, serverId);
      return yield* driver.state(token, ids);
    }),
    stop: Effect.fn("HostedDeploy.stop")(function* (app, serverId) {
      const { driver, ids, token } = yield* linked(app, serverId);
      yield* driver.stop(token, ids);
    }),
    logs: Effect.fn("HostedDeploy.logs")(function* (app, serverId, tail) {
      const { driver, ids, token } = yield* linked(app, serverId);
      return yield* driver.logs(token, ids, tail);
    }),
    label: Effect.fn("HostedDeploy.label")(function* (serverId) {
      return drivers.of((yield* saved.host(serverId)).provider).label;
    }),
  });
});

export const layer = Layer.effect(HostedDeploy, make).pipe(Layer.provide(ProcessRunner.layer));
