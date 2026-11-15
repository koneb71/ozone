import type {
  OzoneDeployStatus,
  OzoneDeployTarget,
  OzoneDeployTrigger,
  OzoneDeploymentEntry,
  OzoneHostProvider,
  OzoneNotifyChannel,
  OzoneNotifyEvent,
  OzoneSavedServer,
  OzoneServerAddInput,
} from "@t3tools/contracts";

import { phaseTone } from "./appPage.logic";

export const HOST = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/;
export const DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export const TRIGGER_LABEL: Record<OzoneDeployTrigger, string> = {
  person: "by you",
  build: "after a build",
  webhook: "from its deploy URL",
  rollback: "rolled back",
};

/** How a deploy is named in the history: its commit's first line, else its commit. */
export function deploymentTitle(entry: OzoneDeploymentEntry): string {
  const sha = entry.commitSha?.slice(0, 7) ?? null;
  if (entry.title === null) return sha === null ? "Unknown version" : `Commit ${sha}`;
  return entry.title;
}

/** How long a deploy took, as people say it. */
export function durationLabel(entry: OzoneDeploymentEntry): string | null {
  if (entry.finishedAt === null) return null;
  const seconds = Math.max(
    0,
    Math.round((Date.parse(entry.finishedAt) - Date.parse(entry.startedAt)) / 1000),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The state of production in a few words, the same wherever it is shown. */
export function deployStateLine(status: OzoneDeployStatus): string {
  // Held back before anything changed: what ran before still runs.
  if (status.migration !== null && status.state === "failed") {
    return status.deployedAt === null ? "Not deployed" : "Still on the previous version";
  }
  switch (status.state) {
    case "none":
      return "Not deployed";
    case "deploying":
      return status.message ?? "Deploying";
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Last deploy failed";
  }
}

export function deployTone(status: OzoneDeployStatus) {
  switch (status.state) {
    case "running":
      return phaseTone("running");
    case "deploying":
      return phaseTone("starting");
    case "failed":
      return phaseTone("failed");
    case "none":
    case "stopped":
      return phaseTone("stopped");
  }
}

/** Production runs a commit older than the app's newest one. */
export function isBehind(status: OzoneDeployStatus): boolean {
  return (
    status.target !== null &&
    status.headSha !== null &&
    status.commitSha !== null &&
    status.headSha !== status.commitSha
  );
}

/**
 * The one deploy button an app shows. `open` needs a choice first, so it leads to the Deploy
 * section; `push` sends the newest commit to where the app already runs.
 */
/**
 * An app can be deployed once it has come up healthy: before that there is nothing to send. One
 * that is already in production is never hidden, whatever its record says.
 */
export function isDeployable(input: {
  readonly firstStartedAt: string | null | undefined;
  readonly running: boolean;
  readonly status: Pick<OzoneDeployStatus, "target">;
}): boolean {
  return (input.firstStartedAt ?? null) !== null || input.running || input.status.target !== null;
}

export type DeployAction =
  | { readonly kind: "open"; readonly label: string; readonly primary: true }
  | { readonly kind: "busy"; readonly label: string; readonly primary: false }
  | { readonly kind: "push"; readonly label: string; readonly primary: boolean };

export function deployActionOf(status: OzoneDeployStatus): DeployAction {
  if (status.state === "deploying") return { kind: "busy", label: "Deploying…", primary: false };
  if (status.migration !== null) return { kind: "open", label: "Review migration", primary: true };
  if (status.target === null) {
    return {
      kind: "open",
      label: status.state === "failed" ? "Try again" : "Deploy",
      primary: true,
    };
  }
  if (status.state === "failed") return { kind: "push", label: "Try again", primary: true };
  if (status.state !== "running") return { kind: "push", label: "Deploy", primary: true };
  return isBehind(status)
    ? { kind: "push", label: "Push update", primary: true }
    : { kind: "push", label: "Deploy again", primary: false };
}

/** Two targets that put the app in the same place, at the same address. */
export function sameTarget(a: OzoneDeployTarget, b: OzoneDeployTarget): boolean {
  return (
    a.host === b.host &&
    a.dokploy === b.dokploy &&
    a.hosted === b.hosted &&
    a.domain === b.domain &&
    a.publicUrl === b.publicUrl
  );
}

export type ChannelKind = OzoneNotifyChannel["kind"];

export interface ChannelDraft {
  readonly kind: ChannelKind;
  readonly name: string;
  readonly url: string;
  readonly botToken: string;
  readonly chatId: string;
  readonly events: ReadonlyArray<OzoneNotifyEvent>;
}

const HTTPS = /^https:\/\/\S+$/;

/** The channel a form describes, or what is wrong with it. */
export function channelFromDraft(
  id: string,
  draft: ChannelDraft,
): { readonly channel: OzoneNotifyChannel } | { readonly problem: string } {
  const name = draft.name.trim() || DEFAULT_NAME[draft.kind];
  const url = draft.url.trim();
  if (draft.events.length === 0) return { problem: "Choose at least one thing to be told about." };
  const base = { id, name, events: [...draft.events] };
  switch (draft.kind) {
    case "slack":
    case "discord":
      return HTTPS.test(url)
        ? { channel: { ...base, kind: draft.kind, webhookUrl: url } }
        : {
            problem: `Paste the ${DEFAULT_NAME[draft.kind]} webhook URL, which starts with https://.`,
          };
    case "webhook":
      return HTTPS.test(url)
        ? { channel: { ...base, kind: "webhook", url } }
        : { problem: "The URL starts with https://." };
    case "telegram": {
      const botToken = draft.botToken.trim();
      const chatId = draft.chatId.trim();
      if (!/^\d+:[\w-]+$/.test(botToken)) {
        return { problem: "A bot token looks like 123456:ABC-DEF, as BotFather gives it." };
      }
      if (chatId.length === 0) return { problem: "Name the chat the bot writes to." };
      return { channel: { ...base, kind: "telegram", botToken, chatId } };
    }
  }
}

export const DEFAULT_NAME: Record<ChannelKind, string> = {
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  webhook: "Webhook",
};

export type ServerMethod = "own-keys" | "ozone-key" | "password" | "dokploy" | OzoneHostProvider;

/** What a person should know about a hosting platform before picking it. */
export const HOST_INFO: Record<
  OzoneHostProvider,
  { readonly label: string; readonly token: string; readonly note: string }
> = {
  railway: {
    label: "Railway",
    token: "An account token from Railway's Account Settings → Tokens, with no workspace chosen.",
    note: "Builds from the app's GitHub repository, which Railway must be connected to. Railway gives a trial credit, then charges.",
  },
  render: {
    label: "Render",
    token: "An API key from Render's Account Settings → API Keys.",
    note: "Builds from the app's Git repository. Render's free app sleeps when idle, and Render deletes a free database after about a month.",
  },
  koyeb: {
    label: "Koyeb",
    token: "An API access token from Koyeb's Organization Settings → API.",
    note: "Builds from the app's GitHub repository, which Koyeb's GitHub app must be installed for. One free app and one small free database per organization.",
  },
  vercel: {
    label: "Vercel",
    token: "A token from Vercel's Account Settings → Tokens.",
    note: "Vercel runs no database, so it is only for an app that keeps no data. Ozone uploads the app's files; no Git remote is needed.",
  },
};
/** Whether a server builds the app from its Git remote, rather than from files Ozone sends. */
function buildsFromRemote(server: OzoneSavedServer | null): boolean {
  if (server === null) return false;
  return server.kind === "dokploy" || (server.kind === "host" && server.provider !== "vercel");
}

/** What stands between an app and a server that builds from its remote. */
export type RemoteNeed =
  | { readonly kind: "none" }
  | { readonly kind: "checking" }
  | { readonly kind: "sign-in" }
  | { readonly kind: "create"; readonly repository: string };

export function remoteNeedOf(input: {
  readonly server: OzoneSavedServer | null;
  /** Null until the app's Git status is known. */
  readonly hasRemote: boolean | null;
  /** Null until GitHub's sign-in state is known. */
  readonly signedIn: boolean | null;
  /** The name a new repository would get, as `owner/name`. */
  readonly repository: string | null;
}): RemoteNeed {
  if (!buildsFromRemote(input.server) || input.hasRemote === true) return { kind: "none" };
  if (input.hasRemote === null || input.signedIn === null) return { kind: "checking" };
  return input.signedIn && input.repository !== null
    ? { kind: "create", repository: input.repository }
    : { kind: "sign-in" };
}

const HOST_PROVIDERS = Object.keys(HOST_INFO) as ReadonlyArray<OzoneHostProvider>;

export function isHostMethod(method: ServerMethod): method is OzoneHostProvider {
  return (HOST_PROVIDERS as ReadonlyArray<string>).includes(method);
}

export interface ServerDraft {
  readonly method: ServerMethod;
  readonly name: string;
  readonly host: string;
  readonly password: string;
  readonly url: string;
  readonly apiKey: string;
}

const DOKPLOY_URL = /^https?:\/\/[^\s/]+(?::\d{1,5})?\/?$/;

/** The server a form describes, or what is wrong with it. */
export function serverFromDraft(
  draft: ServerDraft,
): { readonly server: OzoneServerAddInput } | { readonly problem: string } {
  const host = draft.host.trim();
  if (isHostMethod(draft.method)) {
    const token = draft.apiKey.trim();
    if (token.length === 0) return { problem: "Paste the token." };
    const name = (draft.name.trim() || HOST_INFO[draft.method].label).slice(0, 64);
    return { server: { kind: "host", name, provider: draft.method, token } };
  }
  if (draft.method === "dokploy") {
    const url = draft.url.trim().replace(/\/+$/, "");
    const apiKey = draft.apiKey.trim();
    if (!DOKPLOY_URL.test(url)) {
      return { problem: "The address you open Dokploy at, such as https://dokploy.example.com." };
    }
    if (apiKey.length === 0)
      return { problem: "Paste an API key from Dokploy's profile settings." };
    const name = draft.name.trim() || url.replace(/^https?:\/\//, "");
    return { server: { kind: "dokploy", name: name.slice(0, 64), url, apiKey } };
  }
  if (!HOST.test(host) || !host.includes("@")) {
    return {
      problem: "Name it as user@host, such as root@203.0.113.7 or deploy@example.com:2222.",
    };
  }
  const name = (draft.name.trim() || host.replace(/^[^@]*@/, "").replace(/:\d+$/, "")).slice(0, 64);
  if (draft.method === "password") {
    if (draft.password.length === 0) return { problem: "Type the password for that user." };
    return { server: { kind: "ssh-password", name, host, password: draft.password } };
  }
  return { server: { kind: "ssh", name, host, access: draft.method } };
}

export const SERVER_METHOD_LABEL: Record<ServerMethod, string> = {
  "own-keys": "This computer's SSH keys",
  "ozone-key": "Paste Ozone's key on it",
  password: "Sign in with a password once",
  dokploy: "Dokploy, with an API key",
  railway: "Railway, with a token",
  render: "Render, with an API key",
  koyeb: "Koyeb, with a token",
  vercel: "Vercel, with a token",
};
