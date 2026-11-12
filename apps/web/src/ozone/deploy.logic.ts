import type {
  OzoneDeployTrigger,
  OzoneDeploymentEntry,
  OzoneNotifyChannel,
  OzoneNotifyEvent,
  OzoneServerAddInput,
} from "@t3tools/contracts";

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

export type ServerMethod = "own-keys" | "ozone-key" | "password" | "dokploy";

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
};
