import {
  OzoneAppError,
  OzoneNotifyChannel,
  type OzoneNotifyChannelSummary,
  type OzoneNotifyEvent,
  type OzoneNotifyListResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import { ENV_FILE_MODE } from "../env/envFile.ts";

export interface Notice {
  readonly event: OzoneNotifyEvent;
  readonly app: string;
  /** One line a person reads first. */
  readonly title: string;
  readonly detail: string | null;
  readonly url: string | null;
  readonly commitSha: string | null;
}

/**
 * Tells people what happened to their deploys, on Slack, Discord, Telegram or any URL that takes
 * a JSON POST. Channels and their secrets live in one file only the server reads.
 */
export class Notifier extends Context.Service<
  Notifier,
  {
    readonly list: Effect.Effect<OzoneNotifyListResult, OzoneAppError>;
    readonly set: (
      channel: OzoneNotifyChannel,
    ) => Effect.Effect<OzoneNotifyListResult, OzoneAppError>;
    readonly remove: (id: string) => Effect.Effect<OzoneNotifyListResult, OzoneAppError>;
    /** Sends a test message; fails with what the service answered. */
    readonly test: (id: string) => Effect.Effect<void, OzoneAppError>;
    /** Never fails: a channel that is down must not fail what it reports on. */
    readonly notify: (notice: Notice) => Effect.Effect<void>;
  }
>()("t3/ozone/deploy/Notifier") {}

const ChannelsFile = Schema.fromJsonString(
  Schema.Struct({ channels: Schema.Array(OzoneNotifyChannel) }),
);
const decodeChannels = Schema.decodeUnknownEffect(ChannelsFile);
const encodeChannels = Schema.encodeEffect(ChannelsFile);
const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

const lastChars = (secret: string) => `…${secret.slice(-4)}`;
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Where a channel goes, without what would let someone else post there. */
const destinationOf = (channel: OzoneNotifyChannel): string => {
  switch (channel.kind) {
    case "slack":
      return `Slack webhook ${lastChars(channel.webhookUrl)}`;
    case "discord":
      return `Discord webhook ${lastChars(channel.webhookUrl)}`;
    case "telegram":
      return `Telegram chat ${channel.chatId}`;
    case "webhook":
      return hostOf(channel.url);
  }
};

const summaryOf = (channel: OzoneNotifyChannel): OzoneNotifyChannelSummary => ({
  id: channel.id,
  name: channel.name,
  events: channel.events,
  kind: channel.kind,
  destination: destinationOf(channel),
});

/** The text a chat service shows. */
const noticeText = (notice: Notice): string =>
  [
    notice.title,
    notice.detail,
    notice.url === null ? null : `Open it: ${notice.url}`,
    notice.commitSha === null ? null : `Commit ${notice.commitSha.slice(0, 7)}`,
  ]
    .filter((line): line is string => line !== null && line.length > 0)
    .join("\n");

/** The request each kind of channel takes. */
const requestFor = (
  channel: OzoneNotifyChannel,
  notice: Notice,
): HttpClientRequest.HttpClientRequest => {
  const text = noticeText(notice);
  switch (channel.kind) {
    case "slack":
      return HttpClientRequest.post(channel.webhookUrl).pipe(
        HttpClientRequest.bodyJsonUnsafe({ text }),
      );
    case "discord":
      return HttpClientRequest.post(channel.webhookUrl).pipe(
        // Discord refuses content over 2,000 characters.
        HttpClientRequest.bodyJsonUnsafe({ content: text.slice(0, 1_990) }),
      );
    case "telegram":
      return HttpClientRequest.post(
        `https://api.telegram.org/bot${channel.botToken}/sendMessage`,
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          chat_id: channel.chatId,
          text: text.slice(0, 4_000),
          disable_web_page_preview: true,
        }),
      );
    case "webhook":
      return HttpClientRequest.post(channel.url).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          event: notice.event,
          app: notice.app,
          title: notice.title,
          detail: notice.detail,
          url: notice.url,
          commitSha: notice.commitSha,
        }),
      );
  }
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const http = yield* HttpClient.HttpClient;
  const file = path.join(config.stateDir, "ozone", "notifications.json");
  const writing = yield* Semaphore.make(1);

  const read = fs.readFileString(file).pipe(
    Effect.map((json): string | null => json),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
    Effect.flatMap((json) =>
      json === null ? Effect.succeed({ channels: [] }) : decodeChannels(json),
    ),
    Effect.map((stored) => stored.channels),
    Effect.mapError(() => failed(`Ozone could not read ${file}.`)),
  );
  const write = Effect.fn("Notifier.write")(
    function* (channels: ReadonlyArray<OzoneNotifyChannel>) {
      const json = yield* encodeChannels({ channels });
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(`${file}.tmp`, json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(`${file}.tmp`, ENV_FILE_MODE);
      yield* fs.rename(`${file}.tmp`, file);
    },
    Effect.mapError(() => failed("Ozone could not save the notification settings.")),
  );
  const listed = (channels: ReadonlyArray<OzoneNotifyChannel>) => ({
    channels: channels.map(summaryOf),
  });
  const send = (channel: OzoneNotifyChannel, notice: Notice) =>
    http
      .execute(requestFor(channel, notice))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeout(Duration.seconds(15)),
        Effect.asVoid,
      );

  return Notifier.of({
    list: Effect.map(read, listed),
    set: Effect.fn("Notifier.set")((channel) =>
      writing.withPermits(1)(
        Effect.gen(function* () {
          const channels = yield* read;
          const next = channels.some((entry) => entry.id === channel.id)
            ? channels.map((entry) => (entry.id === channel.id ? channel : entry))
            : [...channels, channel];
          yield* write(next);
          return listed(next);
        }),
      ),
    ),
    remove: Effect.fn("Notifier.remove")((id) =>
      writing.withPermits(1)(
        Effect.gen(function* () {
          const next = (yield* read).filter((entry) => entry.id !== id);
          yield* write(next);
          return listed(next);
        }),
      ),
    ),
    test: Effect.fn("Notifier.test")(function* (id) {
      const channel = (yield* read).find((entry) => entry.id === id);
      if (channel === undefined) return yield* failed("That channel no longer exists.");
      yield* send(channel, {
        event: "deploy.succeeded",
        app: "Ozone",
        title: "Ozone can reach this channel.",
        detail: "Deploys will be reported here.",
        url: null,
        commitSha: null,
      }).pipe(
        Effect.mapError(() =>
          failed(`${destinationOf(channel)} did not accept the message. Check its address.`),
        ),
      );
    }),
    notify: Effect.fn("Notifier.notify")((notice) =>
      read.pipe(
        Effect.flatMap((channels) =>
          Effect.forEach(
            channels.filter((channel) => channel.events.includes(notice.event)),
            (channel) =>
              send(channel, notice).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Ozone could not send a notification", {
                    channel: destinationOf(channel),
                    cause,
                  }),
                ),
              ),
            { concurrency: 4, discard: true },
          ),
        ),
        Effect.catch((cause) => Effect.logWarning("Ozone could not read its notifications", cause)),
      ),
    ),
  });
});

export const layer = Layer.effect(Notifier, make);
