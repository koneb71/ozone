import { describe, expect, it } from "vite-plus/test";

import type { OzoneSavedServer } from "@t3tools/contracts";

import {
  channelFromDraft,
  remoteNeedOf,
  serverFromDraft,
  type ChannelDraft,
  type ServerDraft,
} from "./deploy.logic";

const draft = (extra: Partial<ChannelDraft>): ChannelDraft => ({
  kind: "slack",
  name: "",
  url: "",
  botToken: "",
  chatId: "",
  events: ["deploy.failed"],
  ...extra,
});

describe("channelFromDraft", () => {
  it("builds each kind of channel, named after its service when unnamed", () => {
    expect(channelFromDraft("a", draft({ url: " https://hooks.slack.com/services/x " }))).toEqual({
      channel: {
        id: "a",
        name: "Slack",
        events: ["deploy.failed"],
        kind: "slack",
        webhookUrl: "https://hooks.slack.com/services/x",
      },
    });
    expect(
      channelFromDraft(
        "b",
        draft({ kind: "telegram", name: "Phone", botToken: "123:abc-DEF", chatId: "42" }),
      ),
    ).toMatchObject({ channel: { kind: "telegram", name: "Phone", chatId: "42" } });
  });

  it.each([
    [draft({ url: "http://hooks.slack.com/x" }), "starts with https://"],
    [draft({ kind: "telegram", botToken: "nope", chatId: "1" }), "BotFather"],
    [draft({ kind: "telegram", botToken: "1:a", chatId: " " }), "Name the chat"],
    [draft({ url: "https://example.com", events: [] }), "at least one"],
  ])("refuses %#", (input, problem) => {
    const result = channelFromDraft("c", input);
    expect("problem" in result ? result.problem : "").toContain(problem);
  });
});

describe("serverFromDraft", () => {
  const server = (overrides: Partial<ServerDraft>): ServerDraft => ({
    method: "own-keys",
    name: "",
    host: "",
    password: "",
    url: "",
    apiKey: "",
    ...overrides,
  });

  it("names a server after its host, and keeps a password only for that kind", () => {
    expect(serverFromDraft(server({ host: " deploy@example.com:2222 " }))).toEqual({
      server: {
        kind: "ssh",
        name: "example.com",
        host: "deploy@example.com:2222",
        access: "own-keys",
      },
    });
    expect(
      serverFromDraft(server({ method: "password", host: "root@1.2.3.4", password: "pw" })),
    ).toEqual({
      server: { kind: "ssh-password", name: "1.2.3.4", host: "root@1.2.3.4", password: "pw" },
    });
  });

  it("asks for the user, a password, and Dokploy's address and key", () => {
    expect(serverFromDraft(server({ host: "example.com" }))).toHaveProperty("problem");
    expect(serverFromDraft(server({ method: "password", host: "root@a.io" }))).toHaveProperty(
      "problem",
    );
    expect(
      serverFromDraft(server({ method: "dokploy", url: "dokploy.io", apiKey: "k" })),
    ).toHaveProperty("problem");
    expect(
      serverFromDraft(server({ method: "dokploy", url: "https://dokploy.io/", apiKey: " k " })),
    ).toEqual({
      server: { kind: "dokploy", name: "dokploy.io", url: "https://dokploy.io", apiKey: "k" },
    });
    // A hosting platform takes only a token, and is named after itself.
    expect(serverFromDraft(server({ method: "railway" }))).toHaveProperty("problem");
    expect(serverFromDraft(server({ method: "railway", apiKey: " t " }))).toEqual({
      server: { kind: "host", name: "Railway", provider: "railway", token: "t" },
    });
  });
});

describe("remoteNeedOf", () => {
  const dokploy: OzoneSavedServer = {
    id: "d",
    name: "Dokploy",
    kind: "dokploy",
    url: "https://d.io",
    keyHint: "…1",
  };
  const host = (provider: "railway" | "vercel"): OzoneSavedServer => ({
    id: provider,
    name: provider,
    kind: "host",
    provider,
    keyHint: "…1",
  });
  const ssh: OzoneSavedServer = {
    id: "s",
    name: "Prod",
    kind: "ssh",
    host: "root@1.2.3.4",
    access: "own-keys",
  };
  const ready = { hasRemote: false, signedIn: true, repository: "me/notes" };

  it("asks for a repository only where the server clones one and the app has none", () => {
    expect(remoteNeedOf({ ...ready, server: dokploy })).toEqual({
      kind: "create",
      repository: "me/notes",
    });
    expect(remoteNeedOf({ ...ready, server: host("railway") }).kind).toBe("create");
    // Ozone sends these the files itself.
    expect(remoteNeedOf({ ...ready, server: host("vercel") }).kind).toBe("none");
    expect(remoteNeedOf({ ...ready, server: ssh }).kind).toBe("none");
    expect(remoteNeedOf({ ...ready, server: null }).kind).toBe("none");
    expect(remoteNeedOf({ ...ready, server: dokploy, hasRemote: true }).kind).toBe("none");
  });

  it("sends a person to sign in first, and waits while it does not know", () => {
    expect(
      remoteNeedOf({ server: dokploy, hasRemote: false, signedIn: false, repository: null }).kind,
    ).toBe("sign-in");
    expect(remoteNeedOf({ ...ready, server: dokploy, hasRemote: null }).kind).toBe("checking");
    expect(remoteNeedOf({ ...ready, server: dokploy, signedIn: null }).kind).toBe("checking");
  });
});
