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
import * as AppServers from "./AppServers.ts";
import * as DokployDeploy from "./DokployDeploy.ts";
import * as HostedDeploy from "./HostedDeploy.ts";
import * as Notifier from "./Notifier.ts";

const projectId = ProjectId.make("project-notes");
const here = { host: null, dokploy: null, hosted: null, publicUrl: null, domain: null };
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
            if (what === "up app" || what === "up app=2 app") {
              yield* Ref.update(running, (set) => new Set([...set, place]));
            }
            // Behind the proxy, the copy that ran before is found by id and removed.
            if (what === "ps app") {
              const up = (yield* Ref.get(running)).has(place);
              return { code: 0, stdout: up ? "old-1\n" : "", stderr: "", timedOut: false };
            }
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
    const notices = yield* Ref.make<ReadonlyArray<Notifier.Notice>>([]);
    // The snapshots taken so far, each reason once: the fake names a snapshot by its reason.
    const taken = yield* Ref.make<ReadonlyArray<OzoneSnapshot>>([]);
    const app = {
      projectId,
      slug: "notes-a1b2c3",
      name: "Notes",
      templateId: "web-app",
      port: 41_005,
      createdAt: "2026-01-01T00:00:00.000Z",
      settings: DEFAULT_OZONE_APP_SETTINGS,
    };
    // Built into the test's scope: a deploy runs in the service's own fiber, which lives there.
    const context = yield* Layer.build(
      AppDeploy.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-deploy-home-" })),
        Layer.provideMerge(BuildRepo.layer.pipe(Layer.provideMerge(git))),
        Layer.provide(
          Layer.mergeAll(
            docker,
            Layer.mock(AppRegistry.AppRegistry)({
              list: Effect.succeed([app]),
              resolve: () => Effect.succeed({ app, workspaceRoot, manifest }),
            }),
            // Each asks the target's own Docker, which shows where it was aimed.
            Layer.mock(AppData.AppData)({
              listOf: () => Ref.get(taken),
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
                    Effect.andThen(
                      Ref.update(taken, (all) =>
                        all.some((entry) => entry.reason === input.reason)
                          ? all
                          : [...all, snapshotOf(input.reason)],
                      ),
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
            Layer.mock(AppServers.AppServers)({
              ensureProxy: (host) =>
                Ref.update(journal, (all) => [...all, `proxy on ${host ?? "here"}`]),
              routes: () => Effect.succeed(1),
              awaitRoutes: (_host, _slug, count) =>
                Ref.update(journal, (all) => [...all, `routes ${count}`]).pipe(Effect.as(true)),
            }),
            // Only a target that names a Dokploy server reaches Dokploy.
            Layer.mock(DokployDeploy.DokployDeploy)({}),
            Layer.mock(HostedDeploy.HostedDeploy)({}),
            Layer.mock(Notifier.Notifier)({
              notify: (notice) => Ref.update(notices, (all) => [...all, notice]),
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
    const commit = Effect.fn("test.commit")(function* (file: string, message: string) {
      yield* fs.writeFileString(path.join(workspaceRoot, file), `${message}\n`);
      return (yield* repo.commitAll(workspaceRoot, message)) ?? "";
    });
    return {
      deploy,
      calls,
      notices,
      commit,
      running,
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

    // Dokploy keeps its data out of Ozone's reach, so no snapshot could come first.
    const onDokploy = yield* deploy.deploy({
      projectId,
      target: { ...here, dokploy: "dokploy" },
      acceptMigrations: true,
    });
    assert.strictEqual(onDokploy.state, "failed");
    assert.include(onDokploy.message ?? "", "cannot reach the data Dokploy keeps");
    // A hosting platform keeps its data out of reach in the same way.
    const onHost = yield* deploy.deploy({
      projectId,
      target: { ...here, hosted: "railway" },
      acceptMigrations: true,
    });
    assert.strictEqual(onHost.state, "failed");
    assert.include(onHost.message ?? "", "a hosting platform keeps");
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
    const server = {
      host: "deploy@example.com",
      dokploy: null,
      hosted: null,
      publicUrl: null,
      domain: null,
    };
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
    const target = {
      host: "deploy@example.com:2222",
      dokploy: null,
      hosted: null,
      publicUrl: null,
      domain: null,
    };
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

it.effect("serves a domain through the proxy, and switches versions without going down", () =>
  Effect.gen(function* () {
    const { deploy, steps, forget, fs, path, directory } = yield* makeHarness();
    const domain = {
      host: "deploy@example.com",
      dokploy: null,
      hosted: null,
      publicUrl: null,
      domain: "notes.example.com",
    };
    const first = yield* deploy.deploy({ projectId, target: domain });
    assert.include(first, { state: "running", url: "https://notes.example.com" });
    assert.deepStrictEqual((yield* steps).slice(0, 2), ["proxy on deploy@example.com", "build"]);
    // Nothing ran before, so it simply starts.
    assert.include(yield* steps, "up app");

    const override = yield* fs.readFileString(path.join(directory, "compose.prod.override.yaml"));
    assert.include(override, "ports: !reset []");
    assert.include(
      override,
      'traefik.http.routers.ozone-notes-a1b2c3.rule: "Host(`notes.example.com`)"',
    );
    assert.include(override, 'BETTER_AUTH_URL: "https://notes.example.com"');
    assert.match(override, /networks:\n {2}ozone-proxy:\n {4}external: true/);

    // The next version starts beside the running one, and that one goes once the proxy has both.
    yield* forget;
    yield* deploy.deploy({ projectId, target: domain });
    const switched = yield* steps;
    const from = switched.indexOf("rm app");
    assert.deepStrictEqual(switched.slice(from, from + 6), [
      "rm app",
      "ps app",
      "up app=2 app",
      "routes 2",
      // The old copy is stopped by id on the server itself.
      "ssh://deploy@example.com container stop 20 old-1",
      "ssh://deploy@example.com container rm old-1",
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps each deploy with its output, and rolls back code alone or with its data", () =>
  Effect.gen(function* () {
    const { deploy, steps, forget, commit, notices, head } = yield* makeHarness();
    yield* deploy.deploy({ projectId, target: here });
    const second = yield* commit("notes.ts", "Add notes");
    // Production is behind the newest commit until it is sent to where the app already runs.
    assert.include(yield* deploy.status(projectId), { commitSha: head, headSha: second });
    assert.include(yield* deploy.redeploy(projectId, "person"), {
      commitSha: second,
      headSha: second,
    });

    const { deployments } = yield* deploy.history(projectId);
    assert.deepStrictEqual(
      deployments.map((entry) => [entry.commitSha, entry.title, entry.outcome, entry.current]),
      [
        [second, "Add notes", "succeeded", true],
        [head, "Scaffold", "succeeded", false],
      ],
    );
    const [newest, oldest] = deployments;
    // The second deploy saved the data as the first version left it.
    assert.strictEqual(oldest?.dataSnapshotId, newest?.snapshotId);
    assert.include(yield* deploy.output(projectId, oldest?.id ?? ""), "$ docker compose build");
    assert.deepStrictEqual(
      (yield* Ref.get(notices)).map((notice) => notice.event),
      ["deploy.succeeded", "deploy.succeeded"],
    );

    // Code only: the data stays as it is.
    yield* forget;
    const back = yield* deploy.rollback({ projectId, deploymentId: oldest?.id ?? "" });
    assert.include(back, { state: "running", commitSha: head });
    assert.notInclude((yield* steps).join("|"), "pg_restore");

    // With its data: loaded after a snapshot of what is there now, before the migrations.
    yield* forget;
    yield* deploy.rollback({ projectId, deploymentId: oldest?.id ?? "", restoreData: true });
    const withData = yield* steps;
    assert.deepStrictEqual(withData.slice(1, 7), [
      "up db",
      "exec pg_dump",
      "snapshot before-deploy",
      "exec pg_restore snapshot-before-deploy",
      "run migrate",
      "up app",
    ]);
    const latest = (yield* deploy.history(projectId)).deployments[0];
    assert.include(latest, { trigger: "rollback", commitSha: head, current: true });

    // A version that never ran cannot be gone back to.
    const refused = yield* Effect.flip(deploy.rollback({ projectId, deploymentId: "nope" }));
    assert.include(refused.message, "succeeded");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("reports a failed deploy, and a webhook URL redeploys where the app runs", () =>
  Effect.gen(function* () {
    const { deploy, notices } = yield* makeHarness({ failAt: "build" });
    yield* Effect.flip(deploy.webhook({ projectId, action: "show" }));
    yield* deploy.deploy({ projectId, target: here });
    const [failure] = yield* Ref.get(notices);
    assert.strictEqual(failure?.event, "deploy.failed");
    assert.include(failure?.detail ?? "", "npm ERR! build failed");
    assert.strictEqual((yield* deploy.history(projectId)).deployments[0]?.outcome, "failed");

    const { deploy: other } = yield* makeHarness();
    yield* other.deploy({ projectId, target: here });
    const shown = yield* other.webhook({ projectId, action: "show" });
    assert.match(shown.path ?? "", /^\/api\/ozone\/deploy\/[0-9a-f]{64}$/);
    assert.deepStrictEqual(yield* other.webhook({ projectId, action: "show" }), shown);
    const token = (shown.path ?? "").split("/").at(-1) ?? "";
    assert.strictEqual(yield* other.redeployByToken("0".repeat(64)), "unknown");
    assert.strictEqual(yield* other.redeployByToken(token), "started");

    const rotated = yield* other.webhook({ projectId, action: "rotate" });
    assert.notStrictEqual(rotated.path, shown.path);
    assert.deepStrictEqual(yield* other.webhook({ projectId, action: "disable" }), { path: null });
    assert.strictEqual(yield* other.redeployByToken(token), "unknown");
  }).pipe(Effect.provide(layerTest)),
);
