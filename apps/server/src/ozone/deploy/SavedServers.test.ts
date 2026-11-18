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
