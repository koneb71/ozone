import { describe, expect, it } from "vite-plus/test";

import { channelFromDraft, type ChannelDraft } from "./deploy.logic";

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
