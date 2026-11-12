import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  ProjectId,
  type OzoneAppManifest,
  type OzoneSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildRepo from "../builds/BuildRepo.ts";
import * as AppData from "../data/AppData.ts";
import * as DockerCli from "../runtime/DockerCli.ts";
import * as AppDeploy from "./AppDeploy.ts";

const projectId = ProjectId.make("project-notes");
const here = { host: null, publicUrl: null };
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
  data: {
    services: [{ service: "db", kind: "postgres", volume: "pgdata", database: "app", user: "app" }],
  },
  migrations: {
    directory: "drizzle",
    generate: "npm run db:generate",
    apply: "npm run db:migrate",
  },
};
const HELD_BACK = [
  "Ozone held back a migration that can lose data.",
  '0001_drop.sql:1 drops a table: DROP TABLE "notes"',
  "ozone-accept 0001_drop.sql@abc",
].join("\n");

const snapshotOf = (reason: OzoneSnapshot["reason"]): OzoneSnapshot => ({
  id: `snapshot-${reason}`,
  projectId,
  createdAt: "2026-01-01T00:00:00.000Z",
  reason,
  label: null,
  commitSha: null,
  sizeBytes: 1,
});

/** What a Docker call does, after the flags that name the production project. */
const step = (args: ReadonlyArray<string>) => {
  const afterFiles = args.slice(args.lastIndexOf("-f") + 2);
  return afterFiles.filter((arg) => !arg.startsWith("-") && !/^[A-Z_]+=/.test(arg)).join(" ");
};

const makeHarness = (options: { readonly failAt?: string; readonly hostCa?: boolean } = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-deploy-" });
    const workspaceRoot = path.join(root, "notes");
    yield* fs.makeDirectory(workspaceRoot);
    const caFile = path.join(root, "proxy-ca.crt");
    yield* fs.writeFileString(caFile, "-----BEGIN CERTIFICATE-----\n");
    const calls = yield* Ref.make<ReadonlyArray<DockerCli.DockerRunInput>>([]);
    const journal = yield* Ref.make<ReadonlyArray<string>>([]);
    // Where the app runs: this machine ("here") or a server's address.
    const running = yield* Ref.make<ReadonlySet<string>>(new Set());
    // The files each build saw, where Compose was pointed.
    const builtFrom = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    // Set, the migrate step holds back a migration that can lose data unless it is accepted.
    const holdMigration = yield* Ref.make(false);
    const docker = Layer.succeed(
      DockerCli.DockerCli,
      DockerCli.DockerCli.of({
        run: (input) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (all) => [...all, input]);
            const what = step(input.args);
            yield* Ref.update(journal, (all) => [...all, what]);
            if (what === options.failAt) {
              return { code: 1, stdout: "", stderr: "npm ERR! build failed", timedOut: false };
            }
            if (what === "build") {
              const directory = input.args[input.args.indexOf("--project-directory") + 1] ?? "";
              const files = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
              yield* Ref.update(builtFrom, (all) => [...all, files.toSorted()]);
            }
            const accepted = input.args.some((arg) => arg.startsWith("OZONE_ACCEPT_MIGRATIONS="));
            if (what === "run migrate" && (yield* Ref.get(holdMigration)) && !accepted) {
              return { code: 3, stdout: "", stderr: HELD_BACK, timedOut: false };
            }
            const place = input.args[0] === "-H" ? (input.args[1] ?? "") : "here";
            if (what === "up app") yield* Ref.update(running, (set) => new Set([...set, place]));
            if (what === "stop") {
              yield* Ref.update(running, (set) => new Set([...set].filter((at) => at !== place)));
            }
            const stdout =
              what === "ps json app" && (yield* Ref.get(running)).has(place)
                ? '{"Service":"app","State":"running"}\n'
                : "";
            return { code: 0, stdout, stderr: "", timedOut: false };
          }),
      }),
    );
    const git = GitVcsDriver.layer.pipe(
      Layer.provide(ServerConfig.layerTest(root, { prefix: "ozone-deploy-git-" })),
      Layer.provideMerge(VcsProcess.layer),
    );
    // Built into the test's scope: a deploy runs in the service's own fiber, which lives there.
    const context = yield* Layer.build(
      AppDeploy.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-deploy-home-" })),
        Layer.provideMerge(BuildRepo.layer.pipe(Layer.provideMerge(git))),
        Layer.provide(
          Layer.mergeAll(
            docker,
            Layer.mock(AppRegistry.AppRegistry)({
              resolve: () =>
                Effect.succeed({
                  app: {
                    projectId,
                    slug: "notes-a1b2c3",
                    name: "Notes",
                    templateId: "web-app",
                    port: 41_005,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    settings: DEFAULT_OZONE_APP_SETTINGS,
                  },
                  workspaceRoot,
                  manifest,
                }),
            }),
            // Each asks the target's own Docker, which shows where it was aimed.
            Layer.mock(AppData.AppData)({
              listOf: () => Effect.succeed([snapshotOf("manual")]),
              snapshotOf: (target, input) =>
                target
                  .compose(["exec", "pg_dump"])
                  .pipe(
                    Effect.andThen(
                      Ref.update(journal, (all) => [
                        ...all,
                        `snapshot ${input.reason}${input.label === undefined ? "" : ` (${input.label})`}`,
                      ]),
                    ),
                    Effect.as(snapshotOf(input.reason)),
                  ),
              restoreOf: (target, input) =>
                target
                  .compose(["exec", "pg_restore"])
                  .pipe(
                    Effect.andThen(input.restart ?? Effect.void),
                    Effect.as({ safety: snapshotOf("before-restore") }),
                  ),
              loadOf: (target, input) =>
                target
                  .compose(["exec", "pg_restore", input.snapshotId])
                  .pipe(Effect.andThen(input.restart ?? Effect.void)),
            }),
            // Behind a TLS-intercepting proxy, the host names its certificate bundle.
            Layer.succeed(
              HostProcess.Environment,
              options.hostCa === true ? { NODE_EXTRA_CA_CERTS: caFile } : {},
            ),
          ),
        ),
      ),
    );
    const deploy = Context.get(context, AppDeploy.AppDeploy);
    const config = Context.get(context, ServerConfig.ServerConfig);
    const repo = Context.get(context, BuildRepo.BuildRepo);
    const driver = Context.get(context, GitVcsDriver.GitVcsDriver);

    // A repository whose last commit has the production compose file.
    const gitRun = (args: ReadonlyArray<string>) =>
      driver.execute({ operation: "test", cwd: workspaceRoot, args, timeoutMs: 30_000 });
    yield* gitRun(["init", "--initial-branch=main"]);
    yield* gitRun(["config", "user.name", "Ozone test"]);
    yield* gitRun(["config", "user.email", "test@example.com"]);
    yield* fs.writeFileString(
      path.join(workspaceRoot, AppDeploy.PROD_COMPOSE_FILE),
      "services: {}\n",
    );
    const head = (yield* repo.commitAll(workspaceRoot, "Scaffold")) ?? "";

    const directory = path.join(config.stateDir, "ozone", "apps", "notes-a1b2c3");
    const steps = Ref.get(journal);
    const forget = Ref.set(journal, []);
    return {
      deploy,
      calls,
      steps,
      forget,
      builtFrom,
      holdMigration,
      head,
      fs,
      path,
      directory,
      workspaceRoot,
    };
  });

const layerTest = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

it.effect("deploys to this machine: builds, starts its own database, migrates, then the app", () =>
  Effect.gen(function* () {
    const { deploy, calls, steps, forget, builtFrom, head, fs, path, directory, workspaceRoot } =
      yield* makeHarness();
    assert.strictEqual((yield* deploy.status(projectId)).state, "none");

    // Production gets the last commit, never what a worker left uncommitted.
    yield* fs.writeFileString(path.join(workspaceRoot, "half-done.ts"), "export {};\n");
    const deployed = yield* deploy.deploy({ projectId, target: here });
    assert.deepStrictEqual((yield* steps).slice(0, 4), ["build", "up db", "run migrate", "up app"]);
    assert.include(deployed, { state: "running", url: "http://localhost:42005", commitSha: head });
    assert.deepStrictEqual(yield* Ref.get(builtFrom), [[AppDeploy.PROD_COMPOSE_FILE]]);
    const [build] = yield* Ref.get(calls);
    // A project of its own, reachable only from this machine.
    assert.deepStrictEqual(build?.args.slice(0, 3), [
      "compose",
      "--project-name",
      "notes-a1b2c3-prod",
    ]);
    assert.notStrictEqual(build?.args[4], workspaceRoot);
    assert.deepStrictEqual(build?.env, { OZONE_PROD_PORT: "42005", OZONE_PROD_BIND: "127.0.0.1" });

    // The secrets are made once: a database keeps the password it was created with.
    const overridePath = path.join(directory, "compose.prod.override.yaml");
    const first = yield* fs.readFileString(overridePath);
    assert.match(first, /POSTGRES_PASSWORD: "[0-9a-f]{64}"/);
    assert.strictEqual(((yield* fs.stat(overridePath)).mode & 0o777).toString(8), "600");
    // Every later deploy saves the production data before its migrations run.
    yield* forget;
    yield* deploy.deploy({ projectId, target: here });
    assert.deepStrictEqual((yield* steps).slice(0, 6), [
      "build",
      "up db",
      "exec pg_dump",
      "snapshot before-deploy",
      "run migrate",
      "up app",
    ]);
    assert.strictEqual(yield* fs.readFileString(overridePath), first);

    // Stopping keeps the data; nothing in a deploy asks Docker to remove any.
    assert.strictEqual((yield* deploy.stop(projectId)).state, "stopped");
    assert.isFalse((yield* Ref.get(calls)).some((call) => DockerCli.removesData(call.args)));

    // Settings Ozone cannot read are never replaced: new secrets would lock production out of
    // the database it already has.
    const settingsPath = path.join(directory, "deploy.json");
    yield* fs.writeFileString(settingsPath, "{ not json");
    yield* Ref.set(calls, []);
    const refused = yield* deploy.deploy({ projectId, target: here });
    assert.strictEqual(refused.state, "failed");
    assert.include(refused.message ?? "", "deploy.json");
    assert.strictEqual(yield* fs.readFileString(settingsPath), "{ not json");
    assert.deepStrictEqual(yield* Ref.get(calls), []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("runs a migration that can lose data only when the person applies it", () =>
  Effect.gen(function* () {
    const { deploy, calls, steps, holdMigration } = yield* makeHarness();
    yield* Ref.set(holdMigration, true);
    const held = yield* deploy.deploy({ projectId, target: here });
    assert.strictEqual(held.state, "failed");
    assert.include(held.migration ?? "", "drops a table");
    // Production keeps running the old version.
    assert.notInclude(yield* steps, "up app");

    yield* Ref.set(calls, []);
    const applied = yield* deploy.deploy({ projectId, target: here, acceptMigrations: true });
    assert.strictEqual(applied.state, "running");
    assert.isNull(applied.migration);
    const migrate = (yield* Ref.get(calls)).find((call) => step(call.args) === "run migrate");
    assert.include(migrate?.args ?? [], "OZONE_ACCEPT_MIGRATIONS=0001_drop.sql@abc");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("backs up and restores production from the commit it runs", () =>
  Effect.gen(function* () {
    const { deploy, calls, steps, forget, fs, path, workspaceRoot } = yield* makeHarness();
    yield* Effect.flip(deploy.snapshot({ projectId }));
    yield* deploy.deploy({ projectId, target: here });
    // The working tree moves on; production is still the commit that was deployed.
    yield* fs.remove(path.join(workspaceRoot, AppDeploy.PROD_COMPOSE_FILE));
    yield* forget;
    yield* Ref.set(calls, []);

    assert.strictEqual((yield* deploy.snapshot({ projectId })).reason, "manual");
    assert.deepStrictEqual(yield* deploy.snapshots(projectId), [snapshotOf("manual")]);
    const { safety } = yield* deploy.restore({ projectId, snapshotId: "snapshot-manual" });
    assert.strictEqual(safety.reason, "before-restore");
    // After the data: the deployed version's migrations, then the app again.
    assert.deepStrictEqual(yield* steps, [
      "exec pg_dump",
      "snapshot manual",
      "exec pg_restore",
      "run migrate",
      "up app",
    ]);
    for (const call of yield* Ref.get(calls)) {
      assert.notStrictEqual(call.args[4], workspaceRoot);
      assert.include(call.args.join(" "), "compose.prod.override.yaml");
      assert.strictEqual(call.env?.OZONE_PROD_BIND, "127.0.0.1");
    }
  }).pipe(Effect.provide(layerTest)),
);

it.effect("moves to a server with its data, and stops what ran before", () =>
  Effect.gen(function* () {
    const { deploy, calls, steps, forget } = yield* makeHarness();
    const server = { host: "deploy@example.com", publicUrl: null };
    yield* deploy.deploy({ projectId, target: here });
    yield* forget;
    yield* Ref.set(calls, []);

    const moved = yield* deploy.deploy({ projectId, target: server, bringData: true });
    assert.include(moved, { state: "running", url: "http://example.com:42005" });
    assert.deepStrictEqual(yield* steps, [
      "exec pg_dump",
      "snapshot before-deploy (Moved from this machine)",
      "build",
      "up db",
      "exec pg_restore snapshot-before-deploy",
      "run migrate",
      "up app",
      "stop",
      "ps json app",
    ]);
    // The data is read and the old deploy stopped on this machine; the rest is on the server.
    const onServer = (yield* Ref.get(calls)).map((call) => call.args[0] === "-H");
    assert.deepStrictEqual(onServer, [false, true, true, true, true, true, false, true]);
    assert.isFalse((yield* Ref.get(calls)).some((call) => DockerCli.removesData(call.args)));

    // Coming back finds the data it left here, and saves it before migrating.
    yield* forget;
    yield* deploy.deploy({ projectId, target: here, bringData: true });
    assert.deepStrictEqual((yield* steps).slice(0, 4), [
      "build",
      "up db",
      "exec pg_dump",
      "snapshot before-deploy",
    ]);
  }).pipe(Effect.provide(layerTest)),
);

// Found on a real deploy: Compose's bake refuses the bundle unless its file check is off.
it.effect("gives the image build the host's certificate bundle behind a proxy", () =>
  Effect.gen(function* () {
    const { deploy, calls, fs, path, directory } = yield* makeHarness({ hostCa: true });
    yield* deploy.deploy({ projectId, target: here });
    const [build] = yield* Ref.get(calls);
    assert.strictEqual(build?.env?.BUILDX_BAKE_ENTITLEMENTS_FS, "0");
    const override = yield* fs.readFileString(path.join(directory, "compose.prod.override.yaml"));
    assert.include(override, "      secrets:\n        - host_ca");
    assert.match(override, /secrets:\n {2}host_ca:\n {4}file: ".*proxy-ca\.crt"/);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("reaches a Docker host over SSH, and says which step failed", () =>
  Effect.gen(function* () {
    const { deploy, calls } = yield* makeHarness({ failAt: "build" });
    const target = { host: "deploy@example.com:2222", publicUrl: null };
    const failed = yield* deploy.deploy({ projectId, target });
    assert.strictEqual(failed.state, "failed");
    assert.include(failed.message ?? "", "The production image could not be built");
    assert.include(failed.message ?? "", "npm ERR! build failed");
    const [build] = yield* Ref.get(calls);
    assert.deepStrictEqual(build?.args.slice(0, 3), [
      "-H",
      "ssh://deploy@example.com:2222",
      "compose",
    ]);
    assert.deepStrictEqual(build?.env, { OZONE_PROD_PORT: "42005", OZONE_PROD_BIND: "0.0.0.0" });

    const { deploy: other, workspaceRoot, fs, path } = yield* makeHarness();
    yield* fs.remove(path.join(workspaceRoot, AppDeploy.PROD_COMPOSE_FILE));
    const refused = yield* Effect.flip(other.deploy({ projectId, target }));
    assert.include(refused.message, "has no compose.prod.yaml");
  }).pipe(Effect.provide(layerTest)),
);
