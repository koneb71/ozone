import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OzoneDeployTarget } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import * as AppServers from "./AppServers.ts";
import * as Dokploy from "./Dokploy.ts";
import { HostDrivers } from "./hosts/HostDriver.ts";
import * as SavedServers from "./SavedServers.ts";
import * as SshAccess from "./SshAccess.ts";

const decodeTarget = Schema.decodeUnknownEffect(OzoneDeployTarget);

it.effect("keeps reading the servers and targets saved before hosting accounts existed", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-servers-" });
    const verified: Array<string> = [];
    const context = yield* Layer.build(
      SavedServers.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-servers-home-" })),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(SshAccess.SshAccess)({}),
            Layer.mock(AppServers.ServerShell)({}),
            Layer.mock(Dokploy.Dokploy)({}),
            Layer.succeed(
              HostDrivers,
              HostDrivers.of({
                of: (provider) => ({
                  label: provider,
                  clones: true,
                  keepsData: true,
                  verify: (token) => Effect.sync(() => void verified.push(token)),
                  ensure: () => Effect.die("unused"),
                  release: () => Effect.die("unused"),
                  state: () => Effect.die("unused"),
                  stop: () => Effect.die("unused"),
                  logs: () => Effect.die("unused"),
                }),
              }),
            ),
          ),
        ),
      ),
    );
    const config = Context.get(context, ServerConfig.ServerConfig);
    const saved = Context.get(context, SavedServers.SavedServers);
    // As the list was written when it held only SSH and Dokploy servers.
    yield* fs.makeDirectory(path.join(config.stateDir, "ozone"), { recursive: true });
    yield* fs.writeFileString(
      path.join(config.stateDir, "ozone", "servers.json"),
      JSON.stringify({
        servers: [
          { id: "prod", name: "Prod", kind: "ssh", host: "root@1.2.3.4", access: "own-keys" },
          {
            id: "dokploy",
            name: "Dokploy",
            kind: "dokploy",
            url: "https://dokploy.example.com",
            apiKey: "dk-secret-1234",
          },
        ],
      }),
    );

    assert.deepStrictEqual((yield* saved.list).servers[1], {
      id: "dokploy",
      name: "Dokploy",
      kind: "dokploy",
      url: "https://dokploy.example.com",
      keyHint: "…1234",
    });
    assert.strictEqual((yield* saved.dokploy("dokploy")).apiKey, "dk-secret-1234");

    // A hosting account joins them once its token works, and its token stays on the server.
    const added = yield* saved.add({
      kind: "host",
      name: "Railway",
      provider: "railway",
      token: "rw-token-9876",
    });
    assert.deepStrictEqual(verified, ["rw-token-9876"]);
    assert.deepStrictEqual(added.servers[2], {
      id: "railway",
      name: "Railway",
      kind: "host",
      provider: "railway",
      keyHint: "…9876",
    });
    assert.strictEqual((yield* saved.dokploy("dokploy")).apiKey, "dk-secret-1234");

    // A server keeps variables for the apps deployed to it. A secret's value never comes back.
    yield* saved.setVariable({ serverId: "prod", name: "REGION", value: "eu", secret: false });
    const listed = yield* saved.setVariable({
      serverId: "prod",
      name: "API_KEY",
      value: "sk-1",
      secret: true,
    });
    assert.deepStrictEqual(listed.variables, [
      { name: "API_KEY", secret: true, value: null },
      { name: "REGION", secret: false, value: "eu" },
    ]);
    assert.deepStrictEqual(yield* saved.variables("prod"), listed);
    assert.notProperty((yield* saved.list).servers[0], "variables");
    // A deploy finds them by where it runs: an SSH host, or a saved server's id.
    const onServer = (host: string | null, dokploy: string | null) =>
      saved
        .variablesFor({ host, dokploy, hosted: null, publicUrl: null, domain: null })
        .pipe(Effect.map((variables) => variables.map((variable) => variable.name)));
    assert.deepStrictEqual(yield* onServer("root@1.2.3.4", null), ["API_KEY", "REGION"]);
    assert.deepStrictEqual(yield* onServer(null, "dokploy"), []);
    assert.deepStrictEqual(yield* onServer(null, null), []);
    yield* saved.removeVariable({ serverId: "prod", name: "API_KEY" });
    assert.deepStrictEqual(yield* onServer("root@1.2.3.4", null), ["REGION"]);
    assert.include(
      (yield* Effect.flip(saved.variables("gone"))).message,
      "no longer in Ozone's list",
    );

    // A target saved by a Dokploy deploy has no `hosted` field.
    const target = yield* decodeTarget({
      host: null,
      dokploy: "dokploy",
      publicUrl: null,
      domain: "notes.example.com",
    });
    assert.strictEqual(target.dokploy, "dokploy");
    assert.isNull(target.hosted);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
