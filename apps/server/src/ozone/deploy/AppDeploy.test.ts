import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_OZONE_APP_SETTINGS, ProjectId, type OzoneAppManifest } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildRepo from "../builds/BuildRepo.ts";
import * as DockerCli from "../runtime/DockerCli.ts";
import * as AppDeploy from "./AppDeploy.ts";

const projectId = ProjectId.make("project-notes");
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

/** What a Docker call does, after the flags that name the production project. */
const step = (args: ReadonlyArray<string>) => {
  const afterFiles = args.slice(args.lastIndexOf("-f") + 2);
  return afterFiles.filter((arg) => !arg.startsWith("-")).join(" ");
};

const makeHarness = (options: { readonly failAt?: string; readonly hostCa?: boolean } = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-deploy-" });
    const workspaceRoot = path.join(root, "notes");
    yield* fs.makeDirectory(workspaceRoot);
    yield* fs.writeFileString(
      path.join(workspaceRoot, AppDeploy.PROD_COMPOSE_FILE),
      "services: {}\n",
    );
    const caFile = path.join(root, "proxy-ca.crt");
    yield* fs.writeFileString(caFile, "-----BEGIN CERTIFICATE-----\n");
    const calls = yield* Ref.make<ReadonlyArray<DockerCli.DockerRunInput>>([]);
    const running = yield* Ref.make(false);
    const docker = Layer.succeed(
      DockerCli.DockerCli,
      DockerCli.DockerCli.of({
        run: (input) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (all) => [...all, input]);
            const what = step(input.args);
            if (what === options.failAt) {
              return { code: 1, stdout: "", stderr: "npm ERR! build failed", timedOut: false };
            }
            if (what === "up app") yield* Ref.set(running, true);
            if (what === "stop") yield* Ref.set(running, false);
            const stdout =
              what === "ps json app" && (yield* Ref.get(running))
                ? '{"Service":"app","State":"running"}\n'
                : "";
            return { code: 0, stdout, stderr: "", timedOut: false };
          }),
      }),
    );
    // Built into the test's scope: a deploy runs in the service's own fiber, which lives there.
    const context = yield* Layer.build(
      AppDeploy.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-deploy-home-" })),
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
            Layer.mock(BuildRepo.BuildRepo)({ head: () => Effect.succeed("c0ffee") }),
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
    const directory = path.join(config.stateDir, "ozone", "apps", "notes-a1b2c3");
    const steps = Ref.get(calls).pipe(Effect.map((all) => all.map((call) => step(call.args))));
    return { deploy, calls, steps, fs, path, directory, workspaceRoot };
  });

const layerTest = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

it.effect("deploys to this machine: builds, starts its own database, migrates, then the app", () =>
  Effect.gen(function* () {
    const { deploy, calls, steps, fs, path, directory } = yield* makeHarness();
    assert.strictEqual((yield* deploy.status(projectId)).state, "none");

    const deployed = yield* deploy.deploy({ projectId, target: { host: null, publicUrl: null } });
    assert.deepStrictEqual((yield* steps).slice(0, 4), ["build", "up db", "run migrate", "up app"]);
    assert.include(deployed, {
      state: "running",
      url: "http://localhost:42005",
      commitSha: "c0ffee",
    });
    const [build] = yield* Ref.get(calls);
    // A project of its own, reachable only from this machine.
    assert.deepStrictEqual(build?.args.slice(0, 3), [
      "compose",
      "--project-name",
      "notes-a1b2c3-prod",
    ]);
    assert.deepStrictEqual(build?.env, { OZONE_PROD_PORT: "42005", OZONE_PROD_BIND: "127.0.0.1" });

    // The secrets are made once: a database keeps the password it was created with.
    const overridePath = path.join(directory, "compose.prod.override.yaml");
    const first = yield* fs.readFileString(overridePath);
    assert.match(first, /POSTGRES_PASSWORD: "[0-9a-f]{64}"/);
    assert.strictEqual(((yield* fs.stat(overridePath)).mode & 0o777).toString(8), "600");
    yield* deploy.deploy({ projectId, target: { host: null, publicUrl: null } });
    assert.strictEqual(yield* fs.readFileString(overridePath), first);

    // Stopping keeps the data; nothing in a deploy asks Docker to remove any.
    assert.strictEqual((yield* deploy.stop(projectId)).state, "stopped");
    assert.isFalse((yield* Ref.get(calls)).some((call) => DockerCli.removesData(call.args)));

    // Settings Ozone cannot read are never replaced: new secrets would lock production out of
    // the database it already has.
    const settingsPath = path.join(directory, "deploy.json");
    yield* fs.writeFileString(settingsPath, "{ not json");
    yield* Ref.set(calls, []);
    const refused = yield* deploy.deploy({ projectId, target: { host: null, publicUrl: null } });
    assert.strictEqual(refused.state, "failed");
    assert.include(refused.message ?? "", "deploy.json");
    assert.strictEqual(yield* fs.readFileString(settingsPath), "{ not json");
    assert.deepStrictEqual(yield* Ref.get(calls), []);
  }).pipe(Effect.provide(layerTest)),
);

// Found on a real deploy: Compose's bake refuses the bundle unless its file check is off.
it.effect("gives the image build the host's certificate bundle behind a proxy", () =>
  Effect.gen(function* () {
    const { deploy, calls, fs, path, directory } = yield* makeHarness({ hostCa: true });
    yield* deploy.deploy({ projectId, target: { host: null, publicUrl: null } });
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
