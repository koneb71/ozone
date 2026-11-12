import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { OzoneNotifyChannel } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as Notifier from "./Notifier.ts";

const slack: OzoneNotifyChannel = {
  id: "team",
  name: "Team",
  kind: "slack",
  events: ["deploy.failed"],
  webhookUrl: "https://hooks.slack.com/services/T000/B000/secretsecret",
};
const telegram: OzoneNotifyChannel = {
  id: "phone",
  name: "Phone",
  kind: "telegram",
  events: ["deploy.succeeded", "deploy.failed"],
  botToken: "123456:abc-DEF",
  chatId: "42",
};
const failedDeploy: Notifier.Notice = {
  event: "deploy.failed",
  app: "Notes",
  title: "The deploy of Notes failed.",
  detail: "The production image could not be built",
  url: null,
  commitSha: "abcdef1234",
};

const makeNotifier = (status: (url: string) => number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-notify-" });
    const sent: Array<{ readonly url: string; readonly body: string }> = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        sent.push({ url: request.url, body });
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, { status: status(request.url) }),
        );
      }),
    );
    const context = yield* Layer.build(
      Notifier.layer.pipe(
        Layer.provideMerge(ServerConfig.layerTest(root, { prefix: "ozone-notify-home-" })),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      ),
    );
    return {
      notifier: Context.get(context, Notifier.Notifier),
      config: Context.get(context, ServerConfig.ServerConfig),
      sent,
      fs,
    };
  });

it.effect("keeps channels' secrets in a file only the server reads, and never shows them", () =>
  Effect.gen(function* () {
    const { notifier, config, fs } = yield* makeNotifier(() => 200);
    const path = yield* Path.Path;
    yield* notifier.set(slack);
    const { channels } = yield* notifier.set(telegram);
    assert.deepStrictEqual(
      channels.map((channel) => channel.destination),
      ["Slack webhook …cret", "Telegram chat 42"],
    );
    assert.notInclude(JSON.stringify(channels), "secretsecret");
    assert.notInclude(JSON.stringify(channels), "abc-DEF");
    const file = path.join(config.stateDir, "ozone", "notifications.json");
    assert.strictEqual(((yield* fs.stat(file)).mode & 0o777).toString(8), "600");
    // Saving a channel with the same id replaces it.
    yield* notifier.set({ ...slack, name: "Ops" });
    assert.deepStrictEqual(
      (yield* notifier.list).channels.map((channel) => channel.name),
      ["Ops", "Phone"],
    );
    assert.deepStrictEqual(
      (yield* notifier.remove("team")).channels.map((c) => c.id),
      ["phone"],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("sends each event to the channels that asked for it, and survives one that is down", () =>
  Effect.gen(function* () {
    const { notifier, sent } = yield* makeNotifier((url) => (url.includes("slack") ? 500 : 200));
    yield* notifier.set(slack);
    yield* notifier.set(telegram);

    yield* notifier.notify({ ...failedDeploy, event: "deploy.succeeded" });
    assert.deepStrictEqual(
      sent.map((request) => request.url),
      ["https://api.telegram.org/bot123456:abc-DEF/sendMessage"],
    );
    // Slack answers 500: the deploy that is reported does not fail for it.
    yield* notifier.notify(failedDeploy);
    assert.strictEqual(sent.length, 3);
    const slackBody = JSON.parse(
      sent.find((request) => request.url.includes("slack"))?.body ?? "{}",
    );
    assert.strictEqual(
      slackBody.text,
      "The deploy of Notes failed.\nThe production image could not be built\nCommit abcdef1",
    );
    // A test says which channel refused.
    const refused = yield* Effect.flip(notifier.test("team"));
    assert.include(refused.message, "Slack webhook …cret did not accept the message");
    yield* notifier.test("phone");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
