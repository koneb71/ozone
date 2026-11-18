import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OzoneAppError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { TEST_DATABASE, testApp, testManifest } from "../ozone.testkit.ts";
import * as HostedDeploy from "./HostedDeploy.ts";
import { HostDrivers, type HostDriver } from "./hosts/HostDriver.ts";
import * as SavedServers from "./SavedServers.ts";

const manifest = (data: boolean) =>
  testManifest({ data: { services: data ? [TEST_DATABASE] : [] } });
const app = testApp({ port: 41_005 });
const REMOTE = "https://github.com/me/notes.git";

/** A host that remembers what it was asked, and runs every release at once. */
const makeHarness = (options: { readonly keepsData: boolean; readonly data: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-hosted-" });
    const workspaceRoot = path.join(root, "notes");
    const bare = path.join(root, "notes.git");
    const asked: Array<string> = [];
    const releases: Array<{ remote: unknown; env: Record<string, string> }> = [];

    const driver: HostDriver = {
      label: "Testhost",
      clones: true,
      keepsData: options.keepsData,
      verify: () => Effect.void,
      ensure: ({ ids, save }) =>
        Effect.gen(function* () {
          asked.push(ids.serviceId === undefined ? "ensure:new" : "ensure:known");
          const next = { ...ids, serviceId: "service-1" };
          yield* save(next);
          return {
            ids: next,
            url: "https://notes.testhost.app",
            database: options.data
              ? { internal: "postgres://internal/app", external: "postgres://external/app" }
              : null,
          };
        }),
      release: ({ env, source }) =>
        Effect.sync(() => {
          asked.push("release");
          releases.push({ remote: source.remote, env: Object.fromEntries(env) });
          return { ok: true as const };
        }),
      state: () => Effect.succeed("running" as const),
      stop: () => Effect.void,
      logs: () => Effect.succeed(""),
    };

    const runner = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
    const context = yield* Layer.build(
      HostedDeploy.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-hosted-home-" })),
        Layer.provideMerge(runner),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostDrivers, HostDrivers.of({ of: () => driver })),
            Layer.mock(SavedServers.SavedServers)({
              host: () =>
                Effect.succeed({
                  id: "host",
                  name: "Testhost",
                  kind: "host" as const,
                  provider: "railway" as const,
                  token: "token",
                }),
            }),
          ),
        ),
      ),
    );
    const runnerService = Context.get(context, ProcessRunner.ProcessRunner);
    const git = (cwd: string, args: ReadonlyArray<string>) =>
      runnerService.run({ command: "git", args: ["-C", cwd, ...args] });

    yield* fs.makeDirectory(workspaceRoot);
    yield* git(root, ["init", "--bare", "--initial-branch=main", bare]);
    yield* git(workspaceRoot, ["init", "--initial-branch=main"]);
    yield* git(workspaceRoot, ["config", "user.name", "Ozone test"]);
    yield* git(workspaceRoot, ["config", "user.email", "test@example.com"]);
    // The host clones the URL; this machine pushes to the folder standing in for it.
    yield* git(workspaceRoot, ["remote", "add", "origin", REMOTE]);
    yield* git(workspaceRoot, ["config", "remote.origin.pushurl", bare]);
    yield* fs.writeFileString(path.join(workspaceRoot, "compose.prod.yaml"), "services: {}\n");
    yield* git(workspaceRoot, ["add", "--all"]);
    yield* git(workspaceRoot, ["commit", "--message", "Scaffold"]);
    const head = (yield* git(workspaceRoot, ["rev-parse", "HEAD"])).stdout.trim();

    const deployOnce = () =>
      Context.get(context, HostedDeploy.HostedDeploy).deploy({
        app: { app, workspaceRoot, manifest: manifest(options.data) },
        target: { host: null, dokploy: null, hosted: "host", publicUrl: null, domain: null },
        commitSha: head,
        envFor: (publicUrl, databaseUrl) =>
          new Map([
            ["BETTER_AUTH_URL", publicUrl],
            ...(databaseUrl === null ? [] : [["DATABASE_URL", databaseUrl] as const]),
          ]),
        migrate: (databaseUrl) => Effect.sync(() => void asked.push(`migrate:${databaseUrl}`)),
        files: Effect.succeed(workspaceRoot),
        note: () => Effect.void,
        step: () => Effect.void,
      });
    const pushed = Effect.map(git(bare, ["rev-parse", "main"]), (output) => output.stdout.trim());
    return { asked, deployOnce, head, pushed, releases };
  });

it.live(
  "pushes the commit, migrates through the host's outside address, then releases with the inside one",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ keepsData: true, data: true });

      const outcome = yield* harness.deployOnce();
      assert.deepStrictEqual(outcome, { ok: true, url: "https://notes.testhost.app" });
      assert.strictEqual(yield* harness.pushed, harness.head);
      // Migrations reach the database before the new version starts.
      assert.deepStrictEqual(harness.asked, [
        "ensure:new",
        "migrate:postgres://external/app",
        "release",
      ]);
      assert.deepStrictEqual(harness.releases[0], {
        remote: { url: REMOTE, branch: "main" },
        env: {
          BETTER_AUTH_URL: "https://notes.testhost.app",
          DATABASE_URL: "postgres://internal/app",
          PORT: "3000",
        },
      });

      // The second deploy finds what the first one made.
      yield* harness.deployOnce();
      assert.strictEqual(harness.asked[3], "ensure:known");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("refuses a host that cannot keep the app's data, before anything is pushed", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ keepsData: false, data: true });
    const error = yield* Effect.flip(harness.deployOnce());
    assert.instanceOf(error, OzoneAppError);
    assert.include(error.message, "database");
    assert.deepStrictEqual(harness.asked, []);
    assert.notStrictEqual(yield* harness.pushed, harness.head);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
