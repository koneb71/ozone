import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  OzoneAppError,
  ProjectId,
  type OzoneAppManifest,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Dokploy from "./Dokploy.ts";
import * as DokployDeploy from "./DokployDeploy.ts";
import * as GitHubDeployKeys from "./GitHubDeployKeys.ts";
import * as SavedServers from "./SavedServers.ts";

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
};
const app = {
  projectId: ProjectId.make("project-notes"),
  slug: "notes-a1b2c3",
  name: "Notes",
  templateId: "web-app",
  port: 41_005,
  createdAt: "2026-01-01T00:00:00.000Z",
  settings: DEFAULT_OZONE_APP_SETTINGS,
};
const REMOTE = "https://git.example.com/notes.git";

/** A Dokploy that remembers what it was asked, and finishes every deploy at once. */
const makeHarness = (options: {
  readonly remote: boolean;
  /** The remote Dokploy clones, when it is not the default one. */
  readonly url?: string;
  /** Whether GitHub lets Ozone add a deploy key to a private repository. */
  readonly grants?: boolean;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-dokploy-" });
    const workspaceRoot = path.join(root, "notes");
    const bare = path.join(root, "notes.git");
    const calls = yield* Ref.make<ReadonlyArray<{ procedure: string; input: unknown }>>([]);
    const deployed = yield* Ref.make(0);

    const answer = (procedure: string, input: Readonly<Record<string, unknown>>) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (all) => [...all, { procedure, input }]);
        switch (procedure) {
          case "project.create":
            return { project: { projectId: "p1" }, environment: { environmentId: "e1" } };
          case "compose.create":
            return { composeId: "c1", appName: String(input["appName"]) };
          case "compose.one":
            return { composeId: "c1", appName: "ozone-notes-a1b2c3", composeStatus: "done" };
          case "mounts.create":
            return { mountId: "m1" };
          case "sshKey.generate":
            return {
              privateKey:
                "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----",
              publicKey: "ssh-ed25519 AAAAkey dokploy",
            };
          case "sshKey.all":
            return [{ sshKeyId: "key-1", publicKey: "ssh-ed25519 AAAAkey dokploy\n" }];
          case "domain.create":
            return { domainId: "d1" };
          case "compose.deploy":
            yield* Ref.update(deployed, (count) => count + 1);
            return { success: true };
          case "deployment.allByCompose": {
            const count = yield* Ref.get(deployed);
            return Array.from({ length: count }, (_, index) => ({
              deploymentId: `deployment-${index + 1}`,
              status: "done",
              createdAt: `2026-01-01T00:00:0${index}.000Z`,
            }));
          }
          case "deployment.readLogs":
            return "Docker Compose Deployed: ✅";
          default:
            return true;
        }
      });

    const runner = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
    const context = yield* Layer.build(
      DokployDeploy.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-dokploy-home-" })),
        Layer.provideMerge(runner),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Dokploy.Dokploy)({
              query: (_access, procedure, input) => answer(procedure, input ?? {}),
              mutate: (_access, procedure, input) => answer(procedure, input),
            }),
            Layer.mock(GitHubDeployKeys.GitHubDeployKeys)({
              visibility: () => Effect.succeed("private" as const),
              add: () => Effect.succeed(options.grants ?? true),
            }),
            Layer.mock(SavedServers.SavedServers)({
              dokploy: () =>
                Effect.succeed({
                  id: "dokploy",
                  name: "Dokploy",
                  kind: "dokploy" as const,
                  url: "https://dokploy.example.com",
                  apiKey: "key",
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
    if (options.remote) {
      // Dokploy clones the URL; this machine pushes to the folder standing in for it.
      yield* git(workspaceRoot, ["remote", "add", "origin", options.url ?? REMOTE]);
      yield* git(workspaceRoot, ["config", "remote.origin.pushurl", bare]);
    }
    yield* fs.writeFileString(path.join(workspaceRoot, "compose.prod.yaml"), "services: {}\n");
    yield* git(workspaceRoot, ["add", "--all"]);
    yield* git(workspaceRoot, ["commit", "--message", "Scaffold"]);
    const head = (yield* git(workspaceRoot, ["rev-parse", "HEAD"])).stdout.trim();

    const deployOnce = (domain: string | null) =>
      Context.get(context, DokployDeploy.DokployDeploy).deploy({
        app: { app, workspaceRoot, manifest },
        target: { host: null, dokploy: "dokploy", hosted: null, publicUrl: null, domain },
        commitSha: head,
        title: "Scaffold",
        overrideFor: (publicUrl) => `services: {} # ${publicUrl}\n`,
        port: 42_005,
        migrates: true,
        databaseService: "db",
        note: () => Effect.void,
        step: () => Effect.void,
      });
    const pushed = Effect.map(git(bare, ["rev-parse", "main"]), (output) => output.stdout.trim());
    return { calls: Ref.get(calls), deployOnce, head, pushed };
  });

it.live(
  "pushes the commit, makes the Dokploy service once, then deploys it with Ozone's settings",
  () =>
    Effect.gen(function* () {
      const { calls, deployOnce, head, pushed } = yield* makeHarness({ remote: true });

      const outcome = yield* deployOnce("notes.example.com");
      assert.deepStrictEqual(outcome, { ok: true, url: "https://notes.example.com" });
      assert.strictEqual(yield* pushed, head);

      const first = yield* calls;
      const update = first.find((call) => call.procedure === "compose.update")?.input as Record<
        string,
        unknown
      >;
      assert.strictEqual(update["sourceType"], "git");
      assert.strictEqual(update["customGitUrl"], REMOTE);
      assert.strictEqual(update["customGitBranch"], "main");
      // The database, then the migrations, then the app, each with Ozone's file.
      assert.strictEqual(
        update["command"],
        DokployDeploy.dokployCommand({
          appName: "ozone-notes-a1b2c3",
          appService: "app",
          databaseService: "db",
          migrates: true,
        }),
      );
      assert.match(
        String(update["command"]),
        /^compose .* up -d --build --wait db && docker compose .* run --rm --build -T migrate && docker compose .* up -d --build --remove-orphans app$/,
      );
      const mount = first.find((call) => call.procedure === "mounts.create")?.input as Record<
        string,
        unknown
      >;
      assert.strictEqual(mount["content"], "services: {} # https://notes.example.com\n");
      assert.deepStrictEqual(
        first
          .map((call) => call.procedure)
          .filter((procedure) => procedure !== "deployment.allByCompose"),
        [
          "project.create",
          "compose.create",
          "compose.update",
          "mounts.create",
          "domain.create",
          "compose.deploy",
          "deployment.readLogs",
        ],
      );

      // The second deploy reuses the service and its settings file, and keeps the domain.
      yield* deployOnce("notes.example.com");
      const second = (yield* calls).slice(first.length).map((call) => call.procedure);
      assert.isFalse(second.includes("project.create"));
      assert.isFalse(second.includes("domain.create"));
      assert.isTrue(second.includes("mounts.update"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("asks for a Git remote before touching Dokploy", () =>
  Effect.gen(function* () {
    const { calls, deployOnce } = yield* makeHarness({ remote: false });
    const error = yield* Effect.flip(deployOnce(null));
    assert.instanceOf(error, OzoneAppError);
    assert.include(error.message, "Git remote");
    assert.deepStrictEqual(yield* calls, []);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("accepts only a remote Dokploy can clone", () => {
  assert.isTrue(DokployDeploy.cloneableUrl("https://github.com/me/notes.git"));
  assert.isTrue(DokployDeploy.cloneableUrl("git@github.com:me/notes.git"));
  assert.isFalse(DokployDeploy.cloneableUrl("/Users/me/notes"));
  assert.isFalse(DokployDeploy.cloneableUrl("../notes.git"));
});

it.live("lets Dokploy read a private GitHub repository with a key of its own, made once", () =>
  Effect.gen(function* () {
    const { calls, deployOnce } = yield* makeHarness({
      remote: true,
      url: "https://github.com/me/notes.git",
    });
    yield* deployOnce(null);
    const first = yield* calls;
    const update = first.find((call) => call.procedure === "compose.update")?.input as Record<
      string,
      unknown
    >;
    // Cloned over SSH, which is the only form Dokploy uses a key for.
    assert.strictEqual(update["customGitUrl"], "git@github.com:me/notes.git");
    assert.strictEqual(update["customGitSSHKeyId"], "key-1");

    yield* deployOnce(null);
    const second = (yield* calls).slice(first.length);
    assert.isFalse(second.some((call) => call.procedure === "sshKey.create"));
    const again = second.find((call) => call.procedure === "compose.update")?.input as Record<
      string,
      unknown
    >;
    assert.strictEqual(again["customGitSSHKeyId"], "key-1");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("hands over the key to add by hand when GitHub will not take it from Ozone", () =>
  Effect.gen(function* () {
    const { calls, deployOnce } = yield* makeHarness({
      remote: true,
      url: "git@github.com:me/notes.git",
      grants: false,
    });
    const error = yield* Effect.flip(deployOnce(null));
    assert.instanceOf(error, OzoneAppError);
    assert.include(error.message, "https://github.com/me/notes/settings/keys/new");
    assert.include(error.message, "ssh-ed25519 AAAAkey dokploy");
    // Nothing is deployed against a repository Dokploy cannot read.
    assert.isFalse((yield* calls).some((call) => call.procedure === "compose.deploy"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
