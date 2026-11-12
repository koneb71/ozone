import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as DockerCli from "../runtime/DockerCli.ts";
import * as AppServers from "./AppServers.ts";

const INFO =
  '{"ServerVersion":"29.1.0","OperatingSystem":"Ubuntu 24.04","NCPU":2,"MemTotal":4000000000,"DockerRootDir":"/var/lib/docker"}';
const DF =
  "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 400 600 40% /";

interface FakeServer {
  readonly ssh: "ok" | "refused";
  readonly docker: boolean;
  readonly proxy: "" | "running" | "exited";
  readonly portsTaken?: boolean;
}

const makeServers = (initial: FakeServer) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-servers-" });
    const server = yield* Ref.make(initial);
    const said = yield* Ref.make<ReadonlyArray<string>>([]);
    const docker = Layer.succeed(
      DockerCli.DockerCli,
      DockerCli.DockerCli.of({
        run: (input) =>
          Effect.gen(function* () {
            const args = input.args.filter((arg) => arg !== "-H" && !arg.startsWith("ssh://"));
            yield* Ref.update(said, (all) => [...all, `docker ${args.slice(0, 2).join(" ")}`]);
            const state = yield* Ref.get(server);
            const ok = (stdout: string) => ({ code: 0, stdout, stderr: "", timedOut: false });
            if (args[0] === "compose" && args[1] === "version") return ok("5.0.0\n");
            if (args[0] === "info") return state.docker ? ok(INFO) : { ...ok(""), code: 1 };
            if (args[0] === "ps") return ok(`${state.proxy}\n`);
            if (args.includes("up")) {
              if (state.portsTaken === true) {
                return {
                  ...ok(""),
                  code: 1,
                  stderr: "Bind for 0.0.0.0:80 failed: port is already allocated",
                };
              }
              yield* Ref.update(server, (current) => ({ ...current, proxy: "running" as const }));
              return ok("");
            }
            return ok("");
          }),
      }),
    );
    const shell = Layer.succeed(
      AppServers.ServerShell,
      AppServers.ServerShell.of({
        run: (_host, script) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(server);
            if (state.ssh === "refused") {
              return { code: 255, stdout: "", stderr: "Permission denied (publickey)." };
            }
            if (script.includes("get.docker.com")) {
              yield* Ref.update(said, (all) => [...all, "install docker"]);
              yield* Ref.update(server, (current) => ({ ...current, docker: true }));
              return { code: 0, stdout: "", stderr: "" };
            }
            if (script.startsWith("df")) return { code: 0, stdout: DF, stderr: "" };
            return {
              code: 0,
              stdout: state.docker ? "/usr/bin/docker\n" : "ozone-no-docker\n",
              stderr: "",
            };
          }),
      }),
    );
    const context = yield* Layer.build(
      AppServers.layer.pipe(
        Layer.provide(Layer.mergeAll(docker, shell)),
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-servers-home-" })),
      ),
    );
    return { servers: Context.get(context, AppServers.AppServers), said, server };
  });

const host = "deploy@example.com";

it.effect("says what stands between a server and a deploy", () =>
  Effect.gen(function* () {
    const refused = yield* makeServers({ ssh: "refused", docker: false, proxy: "" });
    const unreachable = yield* refused.servers.check(host);
    assert.include(unreachable.problem ?? "", "could not reach example.com over SSH");
    assert.include(unreachable.problem ?? "", "Permission denied (publickey).");
    assert.isFalse(unreachable.canInstallDocker);

    const bare = yield* makeServers({ ssh: "ok", docker: false, proxy: "" });
    const noDocker = yield* bare.servers.check(host);
    assert.include(noDocker, {
      problem: "Docker is not installed on example.com.",
      canInstallDocker: true,
    });

    const ready = yield* makeServers({ ssh: "ok", docker: true, proxy: "" });
    assert.deepStrictEqual(yield* ready.servers.check(host), {
      host,
      problem: null,
      canInstallDocker: false,
      docker: "29.1.0",
      compose: "5.0.0",
      proxy: "missing",
      os: "Ubuntu 24.04",
      cpus: 2,
      memoryBytes: 4_000_000_000,
      diskFreeBytes: 600 * 1024,
      diskTotalBytes: 1000 * 1024,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("installs Docker only when asked, then starts the proxy", () =>
  Effect.gen(function* () {
    const { servers, said } = yield* makeServers({ ssh: "ok", docker: false, proxy: "" });
    const unasked = yield* servers.setup({ host });
    assert.isTrue(unasked.canInstallDocker);
    assert.notInclude(yield* Ref.get(said), "install docker");

    const ready = yield* servers.setup({ host, installDocker: true });
    assert.include(ready, { problem: null, docker: "29.1.0", proxy: "running" });
    assert.include(yield* Ref.get(said), "install docker");

    // A running proxy is left as it is.
    yield* Ref.set(said, []);
    yield* servers.ensureProxy(host);
    assert.notInclude((yield* Ref.get(said)).join("|"), "compose --project-name");

    const taken = yield* makeServers({ ssh: "ok", docker: true, proxy: "", portsTaken: true });
    const error = yield* Effect.flip(taken.servers.ensureProxy(host));
    assert.include(error.message, "Ports 80 and 443 are in use on example.com");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("passes a port to ssh as a flag", () => {
  assert.deepStrictEqual(AppServers.sshArgs("deploy@example.com:2222").slice(-3), [
    "-p",
    "2222",
    "deploy@example.com",
  ]);
  assert.deepStrictEqual(AppServers.sshArgs("example.com").at(-1), "example.com");
});
