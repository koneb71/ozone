import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type ProviderAuthState,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as NodePtyAdapter from "../../terminal/NodePtyAdapter.ts";
import {
  CLAUDE_SUBSCRIPTION_METHOD_ID,
  advertiseClaudeSignIn,
  makeClaudeSubscriptionAuth,
  withoutAmbientClaudeApiKey,
} from "./ClaudeSubscriptionAuth.ts";

const instanceId = ProviderInstanceId.make("claude-sign-in-test");

// Stands in for Claude Code: the same three subcommands, with the login kept in a marker file.
const FAKE_CLAUDE = `#!/bin/sh
state="$CLAUDE_CONFIG_DIR/signed-in"
case "$1 $2" in
  "auth status")
    if [ -f "$state" ]; then echo '{"loggedIn":true}'; else echo '{"loggedIn":false}'; fi ;;
  "auth logout")
    rm -f "$state" ;;
  "auth login")
    [ "$3" = "--claudeai" ] || exit 9
    printf 'If the browser did not open, visit: https://claude.example/authorize\\n'
    printf 'Paste code here if prompted > '
    read code
    [ "$code" = "good-code" ] || exit 1
    mkdir -p "$CLAUDE_CONFIG_DIR" && : > "$state" ;;
  *)
    exit 2 ;;
esac
`;

const layerTest = NodePtyAdapter.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-claude-auth-" });
  const binaryPath = path.join(root, "claude");
  const configDir = path.join(root, "config");
  yield* fs.writeFileString(binaryPath, FAKE_CLAUDE);
  yield* fs.chmod(binaryPath, 0o755);
  const changes = yield* Ref.make(0);
  const controller = yield* makeClaudeSubscriptionAuth({
    instanceId,
    binaryPath,
    environment: { PATH: "/usr/bin:/bin", CLAUDE_CONFIG_DIR: configDir },
    cwd: root,
    configDir,
    onChanged: Ref.update(changes, (count) => count + 1),
  });
  const until = (matches: (state: ProviderAuthState) => boolean) =>
    controller
      .subscribe("owner")
      .pipe(Stream.filter(matches), Stream.runHead, Effect.map(Option.getOrThrow));
  const signIn = Effect.fn("signIn")(function* (code: string) {
    yield* controller.start("owner");
    const waiting = yield* until(
      (state) =>
        state.interaction?.type === "terminal" && state.interaction.output.includes("Paste code"),
    );
    assert.strictEqual(waiting.interaction?.type, "terminal");
    assert.include(
      waiting.interaction?.type === "terminal" ? waiting.interaction.output : "",
      "https://claude.example/authorize",
    );
    assert.isDefined(controller.respond);
    yield* controller.respond!("owner", {
      instanceId,
      flowId: waiting.flowId!,
      interactionId: waiting.interaction!.id,
      response: { type: "terminal", data: `${code}\r` },
    });
    return yield* until((state) => state.phase === "succeeded" || state.phase === "failed");
  });
  return {
    controller,
    changes,
    signIn,
    until,
    signedInMarker: path.join(configDir, "signed-in"),
    fs,
  };
});

it.live("signs in through Claude Code's subscription login and reports the change", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    const idle = yield* harness.until((state) => state.methods !== undefined);
    assert.deepStrictEqual(
      idle.methods?.map((method) => [method.id, method.type]),
      [[CLAUDE_SUBSCRIPTION_METHOD_ID, "terminal"]],
    );

    const done = yield* harness.signIn("good-code");

    assert.strictEqual(done.phase, "succeeded");
    assert.isTrue(yield* harness.fs.exists(harness.signedInMarker));
    assert.strictEqual(yield* Ref.get(harness.changes), 1);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.live("fails without reporting a change when Claude Code rejects the code", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;

    const done = yield* harness.signIn("wrong-code");

    assert.strictEqual(done.phase, "failed");
    assert.strictEqual(done.message, "Claude sign-in did not finish. Start sign-in again.");
    assert.isFalse(yield* harness.fs.exists(harness.signedInMarker));
    assert.strictEqual(yield* Ref.get(harness.changes), 0);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.live("signs out through Claude Code and reports the change", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    yield* harness.signIn("good-code");

    yield* harness.controller.logout(Effect.void);

    assert.isFalse(yield* harness.fs.exists(harness.signedInMarker));
    assert.strictEqual(yield* Ref.get(harness.changes), 2);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it("drops ambient API-key variables and keeps everything else", () => {
  assert.deepStrictEqual(
    withoutAmbientClaudeApiKey({
      ANTHROPIC_API_KEY: "sk-ant-api",
      ANTHROPIC_AUTH_TOKEN: "token",
      CLAUDE_CODE_OAUTH_TOKEN: "subscription-token",
      PATH: "/usr/bin",
    }),
    { CLAUDE_CODE_OAUTH_TOKEN: "subscription-token", PATH: "/usr/bin" },
  );
});

it("advertises in-app sign-in without changing what the snapshot says about installing", () => {
  const bare = { setup: undefined } as unknown as ServerProvider;
  const installable = {
    setup: { canAuthenticate: false, canInstall: true },
  } as unknown as ServerProvider;

  assert.deepStrictEqual(advertiseClaudeSignIn(bare).setup, {
    canAuthenticate: true,
    canInstall: false,
  });
  assert.deepStrictEqual(advertiseClaudeSignIn(installable).setup, {
    canAuthenticate: true,
    canInstall: true,
  });
});
