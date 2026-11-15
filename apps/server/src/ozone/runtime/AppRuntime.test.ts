import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  OzoneAppError,
  ProjectId,
  type OzoneAppManifest,
  type OzoneRuntimeService,
  type OzoneRuntimeStatus,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppData from "../data/AppData.ts";
import * as AppCompose from "./AppCompose.ts";
import * as AppRuntime from "./AppRuntime.ts";
import * as DockerCli from "./DockerCli.ts";

const projectId = ProjectId.make("project-habits");
const manifest: OzoneAppManifest = {
  version: 1,
  runtime: {
    kind: "compose",
    file: "compose.yaml",
    appService: "app",
    appPort: 3000,
    healthPath: "/api/health",
  },
  gates: [],
  data: { services: [{ service: "db", kind: "postgres", volume: "pgdata" }] },
  migrations: {
    directory: "drizzle",
    generate: "npm run db:generate",
    apply: "npm run db:migrate",
  },
};

const service = (
  name: string,
  state: string,
  health: OzoneRuntimeService["health"],
): OzoneRuntimeService => ({ service: name, state, health, data: name === "db" });

const UP =
  "habits-a1b2c3\tapp\trunning\tUp 2 minutes (healthy)\nhabits-a1b2c3\tdb\trunning\tUp 2 minutes (healthy)\n";
const succeeded: DockerCli.DockerRunOutput = { code: 0, stdout: "", stderr: "", timedOut: false };

const makeHarness = (options: { readonly hostCa?: boolean; readonly docker?: "missing" } = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-runtime-" });
    const workspaceRoot = path.join(root, "habits");
    const hostCa = path.join(root, "ca.crt");
    yield* fs.writeFileString(hostCa, "certificate");

    const composeCalls = yield* Queue.unbounded<ReadonlyArray<string>>();
    // How many of the app's exclusive sections are open, and the container actions run outside one.
    const exclusiveDepth = yield* Ref.make(0);
    const outsideExclusive = yield* Ref.make<ReadonlyArray<string>>([]);
    const containers = yield* Ref.make("");
    const started = yield* Deferred.make<DockerCli.DockerRunOutput>();

    const docker = Layer.succeed(
      DockerCli.DockerCli,
      DockerCli.DockerCli.of({
        run: Effect.fn("TestDocker.run")(function* (input) {
          // The probe for the Compose plugin is not an action on an app.
          if (input.args[0] === "compose" && input.args[1] !== "version") {
            yield* Queue.offer(composeCalls, input.args);
            const action = input.args.find((arg) => ["up", "stop", "restart"].includes(arg));
            if (action !== undefined && (yield* Ref.get(exclusiveDepth)) === 0) {
              yield* Ref.update(outsideExclusive, (all) => [...all, action]);
            }
          }
          if (input.args[0] === "version") {
            if (options.docker === "missing") {
              return yield* new DockerCli.DockerUnavailableError({
                detail: "Docker is not installed on this machine.",
              });
            }
            return { ...succeeded, stdout: "29.0.0\n" };
          }
          if (input.args[0] === "ps") return { ...succeeded, stdout: yield* Ref.get(containers) };
          if (input.args.includes("up")) return yield* Deferred.await(started);
          return succeeded;
        }),
      }),
    );
    // Every time the runtime recorded the app's first healthy start.
    const firstStarts = yield* Ref.make<ReadonlyArray<string>>([]);
    const registry = Layer.mock(AppRegistry.AppRegistry)({
      resolve: () =>
        Effect.map(Ref.get(firstStarts), (recorded) => ({
          app: {
            projectId,
            slug: "habits-a1b2c3",
            name: "Habits",
            templateId: "web-app",
            port: 41_000,
            createdAt: "2026-01-01T00:00:00.000Z",
            settings: DEFAULT_OZONE_APP_SETTINGS,
            firstStartedAt: recorded[0] ?? null,
          },
          workspaceRoot,
          manifest,
        })),
      markStarted: (_projectId, at) => Ref.update(firstStarts, (recorded) => [...recorded, at]),
    });
    const snapshots = yield* Queue.unbounded<string>();
    const snapshotFails = yield* Ref.make(false);
    const data = Layer.mock(AppData.AppData)({
      snapshot: (input) =>
        Queue.offer(snapshots, input.reason).pipe(
          Effect.andThen(
            Effect.flatMap(Ref.get(snapshotFails), (fails) =>
              fails
                ? Effect.fail(new OzoneAppError({ reason: "failed", message: "Could not dump." }))
                : Effect.void,
            ),
          ),
          Effect.as({
            id: "snapshot-1",
            projectId,
            createdAt: "2026-01-01T00:00:00.000Z",
            reason: input.reason,
            label: null,
            commitSha: null,
            sizeBytes: 0,
          }),
        ),
      exclusive: (_projectId, effect) =>
        Ref.update(exclusiveDepth, (depth) => depth + 1).pipe(
          Effect.andThen(effect),
          Effect.ensuring(Ref.update(exclusiveDepth, (depth) => depth - 1)),
        ),
    });
    const runtime = yield* AppRuntime.make.pipe(
      Effect.provide(
        Layer.mergeAll(registry, data, AppCompose.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              docker,
              ServerConfig.layerTest(root, { prefix: "ozone-runtime-home-" }),
              Layer.succeed(
                HostProcess.Environment,
                options.hostCa === true ? { NODE_EXTRA_CA_CERTS: hostCa } : {},
              ),
            ),
          ),
        ),
      ),
    );

    const statuses = yield* Queue.unbounded<OzoneRuntimeStatus>();
    const watch = runtime.changes(projectId).pipe(
      Stream.runForEach((status) => Queue.offer(statuses, status)),
      Effect.forkScoped,
    );
    return {
      runtime,
      containers,
      started,
      firstStarts,
      statuses,
      watch,
      composeCalls,
      outsideExclusive,
      snapshots,
      snapshotFails,
      workspaceRoot,
      hostCa,
    };
  });

describe("AppRuntime", () => {
  it("reads every app's containers from one listing", () => {
    assert.deepStrictEqual(
      AppRuntime.parseContainerList(
        [
          "habits-a1b2c3\tapp\trunning\tUp 4 seconds (health: starting)",
          "habits-a1b2c3\tdb\trunning\tUp 5 seconds (healthy)",
          "notes-9f8e7d\tapp\trunning\tUp 2 hours (unhealthy)",
          "notes-9f8e7d\tdb\texited\tExited (0) 3 hours ago",
          "",
        ].join("\n"),
      ),
      [
        { project: "habits-a1b2c3", service: "app", state: "running", health: "starting" },
        { project: "habits-a1b2c3", service: "db", state: "running", health: "healthy" },
        { project: "notes-9f8e7d", service: "app", state: "running", health: "unhealthy" },
        { project: "notes-9f8e7d", service: "db", state: "exited", health: null },
      ],
    );
  });

  it.each<
    readonly [string, Parameters<typeof AppRuntime.derivePhase>[0], OzoneRuntimeStatus["phase"]]
  >([
    ["nothing created yet", { appService: "app", services: [], operation: undefined }, "stopped"],
    [
      "containers exited",
      { appService: "app", services: [service("app", "exited", null)], operation: undefined },
      "stopped",
    ],
    [
      "Ozone is building",
      {
        appService: "app",
        services: [service("app", "running", "healthy")],
        operation: { state: "starting", message: "Building and starting the app." },
      },
      "starting",
    ],
    [
      "the build failed",
      {
        appService: "app",
        services: [],
        operation: { state: "failed", message: "npm ERR!" },
      },
      "failed",
    ],
    [
      "installing dependencies",
      {
        appService: "app",
        services: [service("app", "running", "starting")],
        operation: undefined,
      },
      "starting",
    ],
    [
      "health check failing",
      {
        appService: "app",
        services: [service("app", "running", "unhealthy")],
        operation: undefined,
      },
      "unhealthy",
    ],
    [
      "only the database is up",
      { appService: "app", services: [service("db", "running", "healthy")], operation: undefined },
      "stopped",
    ],
    [
      "a failed start that Docker later recovered",
      {
        appService: "app",
        services: [service("app", "running", "healthy")],
        operation: { state: "failed", message: "timeout" },
      },
      "running",
    ],
    [
      "an app without a health check",
      { appService: "app", services: [service("app", "running", null)], operation: undefined },
      "running",
    ],
  ])("derives the phase when %s", (_name, input, phase) => {
    assert.strictEqual(AppRuntime.derivePhase(input).phase, phase);
  });

  it.effect("starts in the background and reports the app once Docker has it healthy", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ hostCa: true });
      yield* harness.watch;
      assert.strictEqual((yield* Queue.take(harness.statuses)).phase, "stopped");

      const accepted = yield* harness.runtime.act({ projectId, action: "up" });
      assert.strictEqual(accepted.phase, "starting");
      assert.strictEqual((yield* Queue.take(harness.statuses)).phase, "starting");

      yield* Ref.set(harness.containers, UP);
      yield* Deferred.succeed(harness.started, succeeded);
      const running = yield* Queue.take(harness.statuses);
      assert.strictEqual(running.phase, "running");
      assert.strictEqual(running.url, "http://localhost:41000");
      // Recorded when it first comes up, and not again on a later look.
      yield* harness.runtime.status(projectId);
      assert.lengthOf(yield* Ref.get(harness.firstStarts), 1);
      assert.deepStrictEqual(running.services, [
        service("app", "running", "healthy"),
        service("db", "running", "healthy"),
      ]);

      const up = yield* Queue.take(harness.composeCalls);
      // The project is named by the slug, not by the compose file an agent can edit.
      assert.deepStrictEqual(up.slice(0, 7), [
        "compose",
        "--project-name",
        "habits-a1b2c3",
        "--project-directory",
        harness.workspaceRoot,
        "-f",
        `${harness.workspaceRoot}/compose.yaml`,
      ]);
      assert.deepStrictEqual(up.slice(9), ["up", "--detach", "--build"]);
      // The container trusts what the host trusts, through a file kept outside the repository.
      const fs = yield* FileSystem.FileSystem;
      const overridePath = up[8] ?? "";
      assert.notInclude(overridePath, harness.workspaceRoot);
      assert.include(
        yield* fs.readFileString(overridePath),
        `${harness.hostCa}:/ozone-host-ca.crt:ro`,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports why a start failed, and notices a later change by polling", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.watch;
      yield* Queue.take(harness.statuses);
      yield* harness.runtime.act({ projectId, action: "up" });
      yield* Queue.take(harness.statuses);

      yield* Deferred.succeed(harness.started, {
        code: 1,
        stdout: "",
        stderr: 'failed to solve: process "npm ci" did not complete',
        timedOut: false,
      });
      const failed = yield* Queue.take(harness.statuses);
      assert.strictEqual(failed.phase, "failed");
      assert.include(failed.message ?? "", "npm ci");

      // Started by hand in a terminal: nothing tells Ozone, so the poll has to find it.
      yield* Ref.set(harness.containers, UP);
      yield* TestClock.adjust("3 seconds");
      assert.strictEqual((yield* Queue.take(harness.statuses)).phase, "running");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("never asks Docker to remove a volume, whatever the action", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Deferred.succeed(harness.started, succeeded);
      const issued: Array<ReadonlyArray<string>> = [];
      for (const action of ["up", "stop", "restart", "rebuild"] as const) {
        yield* harness.runtime.act({ projectId, action });
        issued.push(yield* Queue.take(harness.composeCalls));
      }
      yield* harness.runtime.apply(projectId);
      issued.push(yield* Queue.take(harness.composeCalls));
      assert.deepStrictEqual(
        issued.map((args) => args.slice(7)),
        [
          ["up", "--detach", "--build"],
          ["stop"],
          ["restart"],
          ["up", "--detach", "--build", "--force-recreate"],
          ["up", "--detach", "--build"],
        ],
      );
      assert.isFalse(issued.some(DockerCli.removesData));
      // None of them can start or stop the app while a restore of its data is under way.
      assert.deepStrictEqual(yield* Ref.get(harness.outsideExclusive), []);
      // Only the rebuild is preceded by a snapshot of the data.
      assert.deepStrictEqual(yield* Queue.takeAll(harness.snapshots), ["before-rebuild"]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("lets Stop replace a start that is still building", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.runtime.act({ projectId, action: "up" });
      yield* Queue.take(harness.composeCalls);
      // A second Start changes nothing while the first is in flight.
      yield* harness.runtime.act({ projectId, action: "up" });

      const stopped = yield* harness.runtime.act({ projectId, action: "stop" });
      assert.strictEqual(stopped.phase, "stopped");
      assert.deepStrictEqual((yield* Queue.take(harness.composeCalls)).slice(7), ["stop"]);

      // The interrupted start must not report back after the stop.
      yield* Deferred.succeed(harness.started, { ...succeeded, code: 1, stderr: "killed" });
      assert.strictEqual((yield* harness.runtime.status(projectId)).phase, "stopped");
      assert.strictEqual(yield* Queue.size(harness.composeCalls), 0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  // A start that began before a setting changed would bring the app up without it.
  it.effect("applies changed settings even while a start is in flight", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.runtime.act({ projectId, action: "up" });
      yield* Queue.take(harness.composeCalls);
      yield* harness.runtime.apply(projectId);
      assert.deepStrictEqual((yield* Queue.take(harness.composeCalls)).slice(7), [
        "up",
        "--detach",
        "--build",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("says what to do when Docker is missing, and starts nothing", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ docker: "missing" });
      const status = yield* harness.runtime.status(projectId);
      assert.strictEqual(status.phase, "unavailable");
      assert.include(status.message ?? "", "Docker is not installed");

      const error = yield* Effect.flip(harness.runtime.act({ projectId, action: "up" }));
      assert.strictEqual(error.reason, "docker_unavailable");
      assert.strictEqual(yield* Queue.size(harness.composeCalls), 0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  // A migration that can lose data waits for a person: the app's own migrate command holds it back
  // and says so in a report, and accepting runs exactly what the report showed, after a snapshot.
  it.effect("runs a held-back migration only when a person accepts it, after a snapshot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* Deferred.succeed(harness.started, succeeded);
      yield* Ref.set(harness.containers, UP);
      const statement = '0001_drop.sql:1 drops a table: DROP TABLE "notes"';
      yield* fs.makeDirectory(path.join(harness.workspaceRoot, ".ozone"), { recursive: true });
      yield* fs.writeFileString(
        path.join(harness.workspaceRoot, ".ozone", "migrations.json"),
        JSON.stringify({ statements: [statement], accept: ["0001_drop.sql@abc"] }),
      );
      assert.strictEqual((yield* harness.runtime.status(projectId)).migration, statement);

      // Nothing runs unless the data it changes was saved first.
      yield* Ref.set(harness.snapshotFails, true);
      yield* Effect.flip(harness.runtime.act({ projectId, action: "migrate" }));
      assert.strictEqual(yield* Queue.size(harness.composeCalls), 0);

      yield* Ref.set(harness.snapshotFails, false);
      yield* Queue.takeAll(harness.snapshots);
      yield* harness.runtime.act({ projectId, action: "migrate" });
      assert.deepStrictEqual(yield* Queue.takeAll(harness.snapshots), ["before-migrate"]);
      assert.deepStrictEqual((yield* Queue.take(harness.composeCalls)).slice(7), [
        "exec",
        "-T",
        "-e",
        "OZONE_ACCEPT_MIGRATIONS=0001_drop.sql@abc",
        "app",
        "sh",
        "-lc",
        "npm run db:migrate",
      ]);
      assert.deepStrictEqual(yield* Ref.get(harness.outsideExclusive), []);
      // Answered, so the banner no longer asks.
      assert.isNull((yield* harness.runtime.status(projectId)).migration);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  // What Docker prints decides which help a person gets: install it, start it, or fix a permission.
  it.each([
    [null, null, "missing"],
    [
      { code: 1, stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock." },
      null,
      "stopped",
    ],
    [
      { code: 1, stderr: "permission denied while trying to connect to the Docker daemon socket" },
      null,
      "denied",
    ],
    [
      { code: 0, stdout: "29.0.0\n" },
      { code: 1, stderr: "docker: 'compose' is not a docker command." },
      "no-compose",
    ],
    [{ code: 0, stdout: "29.0.0\n" }, { code: 0, stdout: "v5.6.1" }, null],
  ] as const)("reads Docker's answers %j and %j as %s", (daemon, compose, problem) => {
    const output = (partial: object | null) =>
      partial === null ? null : { ...succeeded, ...partial };
    const status = AppRuntime.readDockerStatus(output(daemon), output(compose));
    assert.strictEqual(status.problem, problem);
    assert.strictEqual(status.available, problem === null);
  });
});
