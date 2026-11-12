import {
  OzoneAppError,
  OzoneServerHost,
  OzoneServerId,
  OzoneSshAccess,
  type OzoneSavedServer,
  type OzoneServerAddInput,
  type OzoneServerKeyResult,
  type OzoneServerRemoveResult,
  type OzoneServersListResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import { ENV_FILE_MODE } from "../env/envFile.ts";
import * as AppServers from "./AppServers.ts";
import * as Dokploy from "./Dokploy.ts";
import * as SshAccess from "./SshAccess.ts";

const StoredServer = Schema.Union([
  Schema.Struct({
    id: OzoneServerId,
    name: Schema.String,
    kind: Schema.Literal("ssh"),
    host: OzoneServerHost,
    access: OzoneSshAccess,
  }),
  Schema.Struct({
    id: OzoneServerId,
    name: Schema.String,
    kind: Schema.Literal("dokploy"),
    url: Schema.String,
    apiKey: Schema.String,
  }),
]);
export type StoredServer = typeof StoredServer.Type;
export type DokployServer = Extract<StoredServer, { readonly kind: "dokploy" }>;

const ServersFile = Schema.fromJsonString(Schema.Struct({ servers: Schema.Array(StoredServer) }));
const decodeServers = Schema.decodeUnknownEffect(ServersFile);
const encodeServers = Schema.encodeEffect(ServersFile);
const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

/**
 * The servers a person added once and deploys to by name: SSH hosts, which Ozone runs apps on
 * itself, and Dokploy instances, which run the apps Ozone hands them. API keys live in one file
 * only the server reads; clients never see them again.
 */
export class SavedServers extends Context.Service<
  SavedServers,
  {
    readonly list: Effect.Effect<OzoneServersListResult, OzoneAppError>;
    readonly add: (
      input: OzoneServerAddInput,
    ) => Effect.Effect<OzoneServersListResult, OzoneAppError>;
    readonly remove: (id: string) => Effect.Effect<OzoneServerRemoveResult, OzoneAppError>;
    readonly key: Effect.Effect<OzoneServerKeyResult, OzoneAppError>;
    /** A Dokploy server with its API key, for the deploys that run there. */
    readonly dokploy: (id: string) => Effect.Effect<DokployServer, OzoneAppError>;
  }
>()("t3/ozone/deploy/SavedServers") {}

const summaryOf = (server: StoredServer): OzoneSavedServer =>
  server.kind === "ssh"
    ? server
    : {
        id: server.id,
        name: server.name,
        kind: "dokploy",
        url: server.url,
        keyHint: `…${server.apiKey.slice(-4)}`,
      };

/** A short id from the name, unique among `taken`. */
const idFor = (name: string, taken: ReadonlySet<string>): string => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "server";
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
};

const tail = (output: { readonly stdout: string; readonly stderr: string }) =>
  `${output.stdout}\n${output.stderr}`.trim().slice(-1_000);
const placeOf = (host: string) => host.replace(/^[^@]*@/, "").replace(/:\d+$/, "");

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const access = yield* SshAccess.SshAccess;
  const shell = yield* AppServers.ServerShell;
  const dokploy = yield* Dokploy.Dokploy;
  const file = path.join(config.stateDir, "ozone", "servers.json");
  const writing = yield* Semaphore.make(1);

  const read = fs.readFileString(file).pipe(
    Effect.map((json): string | null => json),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
    Effect.flatMap((json) =>
      json === null ? Effect.succeed({ servers: [] }) : decodeServers(json),
    ),
    Effect.map((stored) => stored.servers),
    Effect.mapError(() => failed(`Ozone could not read ${file}.`)),
  );
  const write = Effect.fn("SavedServers.write")(
    function* (servers: ReadonlyArray<StoredServer>) {
      const json = yield* encodeServers({ servers });
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(`${file}.tmp`, json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(`${file}.tmp`, ENV_FILE_MODE);
      yield* fs.rename(`${file}.tmp`, file);
    },
    Effect.mapError(() => failed("Ozone could not save the list of servers.")),
  );
  const listed = (servers: ReadonlyArray<StoredServer>) => ({ servers: servers.map(summaryOf) });

  /** Signs in once with what the server will be reached by, so a wrong one is never kept. */
  const reach = Effect.fn("SavedServers.reach")(function* (host: string, how: string) {
    const output = yield* access.firstContact(host, "echo ozone-ok");
    if (output.code !== 0 || !output.stdout.includes("ozone-ok")) {
      return yield* failed(`Ozone could not sign in to ${placeOf(host)} ${how}\n${tail(output)}`);
    }
  });

  /** What a new server is saved as, once Ozone has signed in to it. */
  const verified = Effect.fn("SavedServers.verified")(function* (
    input: OzoneServerAddInput,
    id: string,
  ): Effect.fn.Return<StoredServer, OzoneAppError> {
    switch (input.kind) {
      case "ssh": {
        if (input.access === "ozone-key") yield* access.publicKey;
        yield* reach(
          input.host,
          input.access === "ozone-key"
            ? "with Ozone's key. Run the command Ozone shows on the server first."
            : "with this computer's SSH keys. Check that `ssh " + input.host + "` works here.",
        );
        return { id, name: input.name, kind: "ssh", host: input.host, access: input.access };
      }
      case "ssh-password": {
        const publicKey = yield* access.publicKey;
        const installed = yield* access.withPassword(
          input.host,
          input.password,
          SshAccess.installKeyScript(publicKey),
        );
        if (installed.code !== 0) {
          return yield* failed(
            /permission denied|authentication/i.test(installed.stderr)
              ? `${placeOf(input.host)} did not accept the password. Check the user name and the password, and that the server allows password sign-in.`
              : `Ozone could not put its key on ${placeOf(input.host)}.\n${tail(installed)}`,
          );
        }
        yield* reach(input.host, "with the key it just installed.");
        return { id, name: input.name, kind: "ssh", host: input.host, access: "ozone-key" };
      }
      case "dokploy": {
        const url = input.url.replace(/\/+$/, "");
        yield* dokploy.verify({ url, apiKey: input.apiKey });
        return { id, name: input.name, kind: "dokploy", url, apiKey: input.apiKey };
      }
    }
  });

  return SavedServers.of({
    list: Effect.map(read, listed),
    add: Effect.fn("SavedServers.add")(function* (input) {
      const before = yield* read;
      const same = before.find((server) =>
        input.kind === "dokploy"
          ? server.kind === "dokploy" && server.url === input.url.replace(/\/+$/, "")
          : server.kind === "ssh" && server.host === input.host,
      );
      if (same !== undefined)
        return yield* failed(`That server is already in the list as ${same.name}.`);
      // Signing in can take a while; the list is only locked to save.
      const server = yield* verified(
        input,
        idFor(input.name, new Set(before.map((entry) => entry.id))),
      );
      return yield* writing.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* read;
          const next = [
            ...current,
            { ...server, id: idFor(server.name, new Set(current.map((entry) => entry.id))) },
          ];
          yield* write(next);
          return listed(next);
        }),
      );
    }),
    remove: Effect.fn("SavedServers.remove")(function* (id) {
      const server = (yield* read).find((entry) => entry.id === id);
      if (server === undefined) return { ...listed(yield* read), problem: null };
      // Ozone's key is shared by every server; this one no longer lets it in.
      let problem: string | null = null;
      if (server.kind === "ssh" && server.access === "ozone-key") {
        const publicKey = yield* access.publicKey;
        const removed = yield* shell
          .run(server.host, SshAccess.removeKeyScript(publicKey))
          .pipe(Effect.option);
        if (removed._tag === "None" || removed.value.code !== 0) {
          problem = `Ozone could not take its key off ${placeOf(server.host)}, so the key still lets Ozone in there. Remove the line ending in "ozone" from ~/.ssh/authorized_keys on the server.`;
        }
      }
      return yield* writing.withPermits(1)(
        Effect.gen(function* () {
          const next = (yield* read).filter((entry) => entry.id !== id);
          yield* write(next);
          return { ...listed(next), problem };
        }),
      );
    }),
    key: Effect.gen(function* () {
      const publicKey = yield* access.publicKey;
      return { publicKey, installCommand: SshAccess.installCommand(publicKey) };
    }).pipe(Effect.withSpan("SavedServers.key")),
    dokploy: Effect.fn("SavedServers.dokploy")(function* (id) {
      const server = (yield* read).find((entry) => entry.id === id);
      if (server?.kind !== "dokploy") {
        return yield* failed(
          "That Dokploy server is no longer in Ozone's list. Add it again under Servers.",
        );
      }
      return server;
    }),
  });
});

export const layer = Layer.effect(SavedServers, make);
