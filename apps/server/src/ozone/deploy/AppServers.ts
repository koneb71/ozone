import {
  OzoneAppError,
  type OzoneServerReport,
  type OzoneServerSetupInput,
} from "@t3tools/contracts";
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
import * as DockerCli from "../runtime/DockerCli.ts";
import { parseDiskFree } from "./metrics.ts";
import * as SshAccess from "./SshAccess.ts";
import {
  PROXY_CONTAINER,
  PROXY_PROJECT,
  proxiedServers,
  proxyComposeFile,
  routeName,
} from "./proxy.ts";

export interface ShellOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a POSIX shell script on this machine, or on a server over SSH with this machine's keys and
 * Ozone's.
 * Kept apart from Docker so tests can play the server.
 */
export class ServerShell extends Context.Service<
  ServerShell,
  {
    readonly run: (
      host: string | null,
      script: string,
      timeout?: Duration.Input,
    ) => Effect.Effect<ShellOutput, OzoneAppError>;
  }
>()("t3/ozone/deploy/AppServers/ServerShell") {}

/** `user@host:2222` as ssh takes it: the port is a flag of its own. */
export const sshArgs = (host: string): ReadonlyArray<string> => {
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(host);
  const destination = match?.[1] ?? host;
  const port = match?.[2];
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    ...(port === undefined ? [] : ["-p", port]),
    destination,
  ];
};

export const layerServerShell = Layer.effect(
  ServerShell,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const access = yield* SshAccess.SshAccess;
    return ServerShell.of({
      run: Effect.fn("ServerShell.run")(function* (host, script, timeout) {
        const output = yield* runner
          .run({
            command: host === null ? "sh" : "ssh",
            args:
              host === null ? ["-s"] : [...(yield* access.sshOptions), ...sshArgs(host), "sh -s"],
            stdin: script,
            timeout: timeout ?? Duration.minutes(1),
            maxOutputBytes: 256 * 1024,
            outputMode: "truncate",
            timeoutBehavior: "timedOutResult",
          })
          .pipe(
            Effect.mapError(
              () =>
                new OzoneAppError({
                  reason: "failed",
                  message:
                    host === null
                      ? "Ozone could not run a command on this machine."
                      : "Ozone could not run ssh. Install an OpenSSH client.",
                }),
            ),
          );
        return {
          code: output.timedOut || output.code === null ? null : Number(output.code),
          stdout: output.stdout,
          stderr: output.stderr,
        };
      }),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));

/**
 * The machines Ozone deploys to: whether Docker answers there, installing it on a server that
 * has none, and the proxy that serves apps with a domain.
 */
export class AppServers extends Context.Service<
  AppServers,
  {
    readonly check: (host: string | null) => Effect.Effect<OzoneServerReport, OzoneAppError>;
    readonly setup: (
      input: OzoneServerSetupInput,
    ) => Effect.Effect<OzoneServerReport, OzoneAppError>;
    /** Starts the proxy on the host unless it runs. */
    readonly ensureProxy: (host: string | null) => Effect.Effect<void, OzoneAppError>;
    /** How many copies of the app the proxy sends requests to now. */
    readonly routes: (host: string | null, slug: string) => Effect.Effect<number>;
    /** Whether the proxy sends requests to at least `count` copies of the app within seconds. */
    readonly awaitRoutes: (
      host: string | null,
      slug: string,
      count: number,
    ) => Effect.Effect<boolean>;
  }
>()("t3/ozone/deploy/AppServers") {}

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });
const placeOf = (host: string | null) =>
  host === null ? "this machine" : host.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
const tail = (output: { readonly stdout: string; readonly stderr: string }) =>
  `${output.stdout}\n${output.stderr}`.trim().slice(-1_500);

// The official script; it runs as root, through sudo when the SSH user is not root.
const INSTALL_DOCKER = [
  "set -e",
  "if command -v docker >/dev/null 2>&1; then exit 0; fi",
  'if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi',
  "curl -fsSL https://get.docker.com | $SUDO sh",
  'if [ -n "$SUDO" ]; then $SUDO usermod -aG docker "$(id -un)"; fi',
].join("\n");

const DockerInfo = Schema.fromJsonString(
  Schema.Struct({
    ServerVersion: Schema.optionalKey(Schema.String),
    OperatingSystem: Schema.optionalKey(Schema.String),
    NCPU: Schema.optionalKey(Schema.Number),
    MemTotal: Schema.optionalKey(Schema.Number),
    DockerRootDir: Schema.optionalKey(Schema.String),
  }),
);
const decodeDockerInfo = Schema.decodeUnknownEffect(DockerInfo);
type DockerInfo = typeof DockerInfo.Type;

const make = Effect.gen(function* () {
  const docker = yield* DockerCli.DockerCli;
  const shell = yield* ServerShell;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const hostArgs = (host: string | null) => (host === null ? [] : ["-H", `ssh://${host}`]);
  const proxyFile = path.join(config.stateDir, "ozone", "proxy", "compose.yaml");

  const proxyState = Effect.fn("AppServers.proxyState")(function* (host: string | null) {
    const output = yield* docker
      .run({
        args: [
          ...hostArgs(host),
          "ps",
          "--all",
          "--filter",
          `name=^${PROXY_CONTAINER}$`,
          "--format",
          "{{.State}}",
        ],
        timeout: Duration.seconds(30),
      })
      .pipe(Effect.option);
    const state = output._tag === "Some" ? output.value.stdout.trim() : "";
    return state === ""
      ? ("missing" as const)
      : state === "running"
        ? ("running" as const)
        : ("stopped" as const);
  });

  const check = Effect.fn("AppServers.check")(function* (
    host: string | null,
  ): Effect.fn.Return<OzoneServerReport, OzoneAppError> {
    const compose = yield* docker
      .run({ args: ["compose", "version", "--short"], timeout: Duration.seconds(30) })
      .pipe(Effect.option);
    const base: OzoneServerReport = {
      host,
      problem: null,
      canInstallDocker: false,
      docker: null,
      compose:
        compose._tag === "Some" && compose.value.code === 0 ? compose.value.stdout.trim() : null,
      proxy: "missing",
      os: null,
      cpus: null,
      memoryBytes: null,
      diskFreeBytes: null,
      diskTotalBytes: null,
    };
    if (host !== null) {
      // Reaching the server comes first: Docker's own error for a refused key says little.
      const reach = yield* shell.run(host, "command -v docker || echo ozone-no-docker");
      if (reach.code !== 0) {
        return {
          ...base,
          problem: `Ozone could not reach ${placeOf(host)} over SSH. Add it under Servers, or check that \`ssh ${host}\` works from this machine without a password prompt.\n${tail(reach)}`,
        };
      }
      if (reach.stdout.includes("ozone-no-docker")) {
        return {
          ...base,
          problem: `Docker is not installed on ${placeOf(host)}.`,
          canInstallDocker: true,
        };
      }
    }
    const info = yield* docker
      .run({
        args: [...hostArgs(host), "info", "--format", "{{json .}}"],
        timeout: Duration.seconds(45),
      })
      .pipe(Effect.option);
    if (info._tag === "None" || info.value.code !== 0) {
      const said = info._tag === "Some" ? tail(info.value) : "";
      const denied = /permission denied/i.test(said);
      return {
        ...base,
        problem: denied
          ? `Docker on ${placeOf(host)} refused this user. Add it to the docker group there, then sign in again.`
          : `Docker did not answer on ${placeOf(host)}. Start it, then check again.\n${said}`,
      };
    }
    const parsed: DockerInfo = yield* decodeDockerInfo(info.value.stdout).pipe(
      Effect.orElseSucceed((): DockerInfo => ({})),
    );
    const root = parsed.DockerRootDir ?? "/";
    const df = yield* shell
      .run(host, `df -Pk '${root.replaceAll("'", "")}' 2>/dev/null || df -Pk /`)
      .pipe(Effect.option);
    const disk = df._tag === "Some" && df.value.code === 0 ? parseDiskFree(df.value.stdout) : null;
    return {
      ...base,
      docker: parsed.ServerVersion ?? null,
      os: parsed.OperatingSystem ?? null,
      cpus: parsed.NCPU ?? null,
      memoryBytes: parsed.MemTotal ?? null,
      diskFreeBytes: disk?.freeBytes ?? null,
      diskTotalBytes: disk?.totalBytes ?? null,
      proxy: yield* proxyState(host),
    };
  });

  const ensureProxy = Effect.fn("AppServers.ensureProxy")(function* (host: string | null) {
    if ((yield* proxyState(host)) === "running") return;
    yield* fs.makeDirectory(path.dirname(proxyFile), { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(proxyFile, proxyComposeFile())),
      Effect.mapError(() => failed("Ozone could not write its proxy's settings.")),
    );
    const output = yield* docker
      .run({
        args: [
          ...hostArgs(host),
          "compose",
          "--project-name",
          PROXY_PROJECT,
          "-f",
          proxyFile,
          "up",
          "--detach",
          "--wait",
        ],
        timeout: Duration.minutes(4),
      })
      .pipe(Effect.mapError((error) => failed(error.detail)));
    if (output.code === 0 && !output.timedOut) return;
    const said = tail(output);
    return yield* failed(
      /address already in use|port is already allocated/i.test(said)
        ? `Ports 80 and 443 are in use on ${placeOf(host)}. Ozone's proxy needs them to serve a domain: stop what uses them, or deploy without a domain.`
        : `Ozone's proxy did not start on ${placeOf(host)}:\n${said}`,
    );
  });

  const routes = (host: string | null, slug: string) =>
    docker
      .run({
        args: [
          ...hostArgs(host),
          "exec",
          PROXY_CONTAINER,
          "wget",
          "-qO-",
          `http://127.0.0.1:8080/api/http/services/${routeName(slug)}@docker`,
        ],
        timeout: Duration.seconds(10),
      })
      .pipe(Effect.map((output) => proxiedServers(output.stdout)));

  return AppServers.of({
    check,
    setup: Effect.fn("AppServers.setup")(function* (input) {
      const before = yield* check(input.host);
      if (before.canInstallDocker && input.host !== null) {
        if (input.installDocker !== true) return before;
        const installed = yield* shell.run(input.host, INSTALL_DOCKER, Duration.minutes(10));
        if (installed.code !== 0) {
          return yield* failed(
            `Docker could not be installed on ${placeOf(input.host)}. The install needs root, or sudo without a password.\n${tail(installed)}`,
          );
        }
      } else if (before.problem !== null) {
        return before;
      }
      const ready = yield* check(input.host);
      if (ready.problem !== null) return ready;
      yield* ensureProxy(input.host);
      return yield* check(input.host);
    }),
    ensureProxy,
    routes: Effect.fn("AppServers.routes")((host, slug) =>
      routes(host, slug).pipe(Effect.orElseSucceed(() => 0)),
    ),
    awaitRoutes: Effect.fn("AppServers.awaitRoutes")((host, slug, count) =>
      routes(host, slug).pipe(
        Effect.flatMap((servers) =>
          servers >= count ? Effect.succeed(true) : Effect.fail("waiting"),
        ),
        Effect.retry({ schedule: Schedule.spaced(Duration.millis(500)), times: 40 }),
        Effect.orElseSucceed(() => false),
      ),
    ),
  });
});

export const layer = Layer.effect(AppServers, make);
