import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const Name = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
const HttpsUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2_048),
  Schema.isPattern(/^https:\/\/\S+$/),
);

/** A Docker host reached with this machine's SSH setup, as `user@host`. */
export const OzoneServerHost = TrimmedNonEmptyString.check(
  Schema.isMaxLength(255),
  Schema.isPattern(/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/),
);

/** A name in DNS that points at the server, such as `notes.example.com`. */
export const OzoneDomain = TrimmedNonEmptyString.check(
  Schema.isMaxLength(253),
  Schema.isPattern(/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/),
);

/** A server saved in Ozone's list. */
export const OzoneServerId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
export type OzoneServerId = typeof OzoneServerId.Type;

/** Where Deploy runs the production image. */
export const OzoneDeployTarget = Schema.Struct({
  /** Null: this machine, or the Dokploy server below. */
  host: Schema.NullOr(OzoneServerHost),
  /** A saved Dokploy server that runs the app instead of Ozone. Null: Ozone runs it. */
  dokploy: Schema.NullOr(OzoneServerId).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** A saved hosting account, such as Railway, that runs the app instead. Null: not hosted. */
  hosted: Schema.NullOr(OzoneServerId).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** Where people reach the app, for sign-in links. Null: the domain, or the host and its port. */
  publicUrl: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(512), Schema.isPattern(/^https?:\/\/\S+$/)),
  ),
  /**
   * Served at `https://<domain>` by Ozone's proxy on the host, with a certificate from Let's
   * Encrypt, and switched to a new version without going down. Null: served on its own port.
   */
  domain: Schema.NullOr(OzoneDomain).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
});
export type OzoneDeployTarget = typeof OzoneDeployTarget.Type;

export const OzoneDeployStatus = Schema.Struct({
  state: Schema.Literals(["none", "deploying", "running", "stopped", "failed"]),
  /** The target of the last deploy. */
  target: Schema.NullOr(OzoneDeployTarget),
  url: Schema.NullOr(Schema.String),
  commitSha: Schema.NullOr(Schema.String),
  deployedAt: Schema.NullOr(IsoDateTime),
  /** What went wrong, or what is happening. */
  message: Schema.NullOr(Schema.String),
  /** The statements of a migration the last deploy held back because it can lose data. */
  migration: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** The app's newest commit. It differs from `commitSha` when production is behind. */
  headSha: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
});
export type OzoneDeployStatus = typeof OzoneDeployStatus.Type;

export const OzoneDeployStatusInput = Schema.Struct({ projectId: ProjectId });
export const OzoneDeployRunInput = Schema.Struct({
  projectId: ProjectId,
  target: OzoneDeployTarget,
  /** Runs the migration the last deploy held back, after the snapshot every deploy takes first. */
  acceptMigrations: Schema.optionalKey(Schema.Boolean),
  /**
   * On a first deploy to a new place: starts from the data of the place deployed before, and stops
   * the deploy there once this one runs. The old volume stays.
   */
  bringData: Schema.optionalKey(Schema.Boolean),
});
export type OzoneDeployRunInput = typeof OzoneDeployRunInput.Type;

/** Deploys the newest commit where the app was last deployed. */
export const OzoneRedeployInput = Schema.Struct({
  projectId: ProjectId,
  acceptMigrations: Schema.optionalKey(Schema.Boolean),
});
export type OzoneRedeployInput = typeof OzoneRedeployInput.Type;

/** What started a deploy. */
export const OzoneDeployTrigger = Schema.Literals(["person", "build", "webhook", "rollback"]);
export type OzoneDeployTrigger = typeof OzoneDeployTrigger.Type;

export const OzoneDeployment = Schema.Struct({
  id: Id,
  trigger: OzoneDeployTrigger,
  target: OzoneDeployTarget,
  commitSha: Schema.NullOr(Schema.String),
  /** The commit's first line, so a person can tell versions apart. */
  title: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  outcome: Schema.Literals(["running", "succeeded", "failed"]),
  message: Schema.NullOr(Schema.String),
  /** The production data just before this deploy changed it. */
  snapshotId: Schema.NullOr(Schema.String),
});
export type OzoneDeployment = typeof OzoneDeployment.Type;

/** A deploy as clients see it, with what a rollback to it can bring back. */
export const OzoneDeploymentEntry = Schema.Struct({
  ...OzoneDeployment.fields,
  /** Runs now, where the app is deployed. */
  current: Schema.Boolean,
  /** A snapshot of the data as this version left it, taken when a later deploy replaced it. */
  dataSnapshotId: Schema.NullOr(Schema.String),
});
export type OzoneDeploymentEntry = typeof OzoneDeploymentEntry.Type;

export const OzoneDeployHistoryResult = Schema.Struct({
  /** Newest first. */
  deployments: Schema.Array(OzoneDeploymentEntry),
});
export type OzoneDeployHistoryResult = typeof OzoneDeployHistoryResult.Type;

export const OzoneDeployOutputInput = Schema.Struct({ projectId: ProjectId, deploymentId: Id });
export type OzoneDeployOutputInput = typeof OzoneDeployOutputInput.Type;
export const OzoneDeployOutputResult = Schema.Struct({ text: Schema.String });
export type OzoneDeployOutputResult = typeof OzoneDeployOutputResult.Type;

export const OzoneDeployRollbackInput = Schema.Struct({
  projectId: ProjectId,
  deploymentId: Id,
  /**
   * Also brings back the data as that version left it. What was written since is replaced, after
   * a snapshot of it.
   */
  restoreData: Schema.optionalKey(Schema.Boolean),
});
export type OzoneDeployRollbackInput = typeof OzoneDeployRollbackInput.Type;

export const OzoneDeployLogsInput = Schema.Struct({
  projectId: ProjectId,
  service: Schema.optionalKey(Name),
  tail: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_000 }))),
});
export type OzoneDeployLogsInput = typeof OzoneDeployLogsInput.Type;

export const OzoneContainerMetrics = Schema.Struct({
  service: Schema.String,
  state: Schema.String,
  /** `healthy`, `unhealthy` or `starting`, for a service with a health check. */
  health: Schema.NullOr(Schema.String),
  cpuPercent: Schema.NullOr(Schema.Number),
  memoryBytes: Schema.NullOr(Schema.Number),
  memoryLimitBytes: Schema.NullOr(Schema.Number),
  networkInBytes: Schema.NullOr(Schema.Number),
  networkOutBytes: Schema.NullOr(Schema.Number),
});
export type OzoneContainerMetrics = typeof OzoneContainerMetrics.Type;

export const OzoneDeployMetrics = Schema.Struct({
  containers: Schema.Array(OzoneContainerMetrics),
  measuredAt: IsoDateTime,
});
export type OzoneDeployMetrics = typeof OzoneDeployMetrics.Type;

export const OzoneDeployWebhookInput = Schema.Struct({
  projectId: ProjectId,
  /** `show` makes a URL the first time; `rotate` replaces it; `disable` removes it. */
  action: Schema.Literals(["show", "rotate", "disable"]),
});
export type OzoneDeployWebhookInput = typeof OzoneDeployWebhookInput.Type;
export const OzoneDeployWebhookResult = Schema.Struct({
  /** The path to POST to on this environment, or null once disabled. */
  path: Schema.NullOr(Schema.String),
});
export type OzoneDeployWebhookResult = typeof OzoneDeployWebhookResult.Type;

/** The path of the URL that deploys an app; the token is its only credential. */
export const OZONE_DEPLOY_WEBHOOK_PATH = "/api/ozone/deploy";

export const OzoneServerInput = Schema.Struct({ host: Schema.NullOr(OzoneServerHost) });
export type OzoneServerInput = typeof OzoneServerInput.Type;

export const OzoneServerReport = Schema.Struct({
  host: Schema.NullOr(Schema.String),
  /** Null when Docker answered; otherwise what is wrong, in words a person can act on. */
  problem: Schema.NullOr(Schema.String),
  /** Docker is not installed there, and Ozone can install it. */
  canInstallDocker: Schema.Boolean,
  docker: Schema.NullOr(Schema.String),
  compose: Schema.NullOr(Schema.String),
  proxy: Schema.Literals(["running", "stopped", "missing"]),
  os: Schema.NullOr(Schema.String),
  cpus: Schema.NullOr(Schema.Number),
  memoryBytes: Schema.NullOr(Schema.Number),
  diskFreeBytes: Schema.NullOr(Schema.Number),
  diskTotalBytes: Schema.NullOr(Schema.Number),
});
export type OzoneServerReport = typeof OzoneServerReport.Type;

export const OzoneServerSetupInput = Schema.Struct({
  host: Schema.NullOr(OzoneServerHost),
  /** Installs Docker with its official script when it is missing. Servers only. */
  installDocker: Schema.optionalKey(Schema.Boolean),
});
export type OzoneServerSetupInput = typeof OzoneServerSetupInput.Type;

const ServerName = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
const DokployUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^https?:\/\/[^\s/]+(?::\d{1,5})?\/?$/),
);

/**
 * How Ozone signs in to an SSH server. `own-keys`: this machine's SSH setup, as `ssh host` would.
 * `ozone-key`: a key Ozone made and installed there; this machine's keys are tried too.
 */
export const OzoneSshAccess = Schema.Literals(["own-keys", "ozone-key"]);
export type OzoneSshAccess = typeof OzoneSshAccess.Type;

/** A hosting platform that builds and runs the app from an API token. */
export const OzoneHostProvider = Schema.Literals(["railway", "render", "koyeb", "vercel"]);
export type OzoneHostProvider = typeof OzoneHostProvider.Type;

/** A server in Ozone's list, as clients see it: never with its secret. */
export const OzoneSavedServer = Schema.Union([
  Schema.Struct({
    id: OzoneServerId,
    name: ServerName,
    kind: Schema.Literal("ssh"),
    host: OzoneServerHost,
    access: OzoneSshAccess,
  }),
  Schema.Struct({
    id: OzoneServerId,
    name: ServerName,
    kind: Schema.Literal("dokploy"),
    url: DokployUrl,
    /** The API key's last characters, so a person can tell keys apart. */
    keyHint: Schema.String,
  }),
  Schema.Struct({
    id: OzoneServerId,
    name: ServerName,
    kind: Schema.Literal("host"),
    provider: OzoneHostProvider,
    keyHint: Schema.String,
  }),
]);
export type OzoneSavedServer = typeof OzoneSavedServer.Type;

export const OzoneServersListResult = Schema.Struct({ servers: Schema.Array(OzoneSavedServer) });
export type OzoneServersListResult = typeof OzoneServersListResult.Type;

/** A server to add. Ozone signs in once before keeping it, so a wrong one is never saved. */
export const OzoneServerAddInput = Schema.Union([
  /** Reached as it is: with this machine's keys, or with Ozone's key already pasted there. */
  Schema.Struct({
    kind: Schema.Literal("ssh"),
    name: ServerName,
    host: OzoneServerHost,
    access: OzoneSshAccess,
  }),
  /** Ozone signs in with the password once to install its key, and keeps only the key. */
  Schema.Struct({
    kind: Schema.Literal("ssh-password"),
    name: ServerName,
    host: OzoneServerHost,
    password: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_024)),
  }),
  Schema.Struct({
    kind: Schema.Literal("dokploy"),
    name: ServerName,
    url: DokployUrl,
    apiKey: TrimmedNonEmptyString.check(Schema.isMaxLength(1_024)),
  }),
  Schema.Struct({
    kind: Schema.Literal("host"),
    name: ServerName,
    provider: OzoneHostProvider,
    token: TrimmedNonEmptyString.check(Schema.isMaxLength(1_024)),
  }),
]);
export type OzoneServerAddInput = typeof OzoneServerAddInput.Type;

export const OzoneServerRemoveInput = Schema.Struct({ id: OzoneServerId });
export type OzoneServerRemoveInput = typeof OzoneServerRemoveInput.Type;
export const OzoneServerRemoveResult = Schema.Struct({
  servers: Schema.Array(OzoneSavedServer),
  /** Why Ozone's key could not be taken off the server, which then still lets it in. */
  problem: Schema.NullOr(Schema.String),
});
export type OzoneServerRemoveResult = typeof OzoneServerRemoveResult.Type;

/** Ozone's SSH key, made the first time it is asked for. */
export const OzoneServerKeyResult = Schema.Struct({
  publicKey: Schema.String,
  /** Run on the server, it lets Ozone's key in. */
  installCommand: Schema.String,
});
export type OzoneServerKeyResult = typeof OzoneServerKeyResult.Type;

export const OzoneNotifyEvent = Schema.Literals(["deploy.succeeded", "deploy.failed"]);
export type OzoneNotifyEvent = typeof OzoneNotifyEvent.Type;

const ChannelBase = {
  id: Id,
  name: Name,
  events: Schema.Array(OzoneNotifyEvent),
};

/** Where Ozone sends a message. The fields after `events` are secrets: written, never read. */
export const OzoneNotifyChannel = Schema.Union([
  Schema.Struct({ ...ChannelBase, kind: Schema.Literal("slack"), webhookUrl: HttpsUrl }),
  Schema.Struct({ ...ChannelBase, kind: Schema.Literal("discord"), webhookUrl: HttpsUrl }),
  Schema.Struct({
    ...ChannelBase,
    kind: Schema.Literal("telegram"),
    botToken: TrimmedNonEmptyString.check(
      Schema.isMaxLength(256),
      Schema.isPattern(/^\d+:[\w-]+$/),
    ),
    chatId: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  }),
  /** A POST with JSON, for anything else. */
  Schema.Struct({ ...ChannelBase, kind: Schema.Literal("webhook"), url: HttpsUrl }),
]);
export type OzoneNotifyChannel = typeof OzoneNotifyChannel.Type;

/** A channel as clients see it: where it goes, without its secret. */
export const OzoneNotifyChannelSummary = Schema.Struct({
  ...ChannelBase,
  kind: Schema.Literals(["slack", "discord", "telegram", "webhook"]),
  destination: Schema.String,
});
export type OzoneNotifyChannelSummary = typeof OzoneNotifyChannelSummary.Type;

export const OzoneNotifyListResult = Schema.Struct({
  channels: Schema.Array(OzoneNotifyChannelSummary),
});
export type OzoneNotifyListResult = typeof OzoneNotifyListResult.Type;
export const OzoneNotifyRemoveInput = Schema.Struct({ id: Id });
export type OzoneNotifyRemoveInput = typeof OzoneNotifyRemoveInput.Type;
