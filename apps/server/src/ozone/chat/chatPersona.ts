import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";

/**
 * A chat's AGENTS.md. Every provider loads that file itself, so no provider adapter is edited.
 * Upstream can turn a chat's folder into a project in place: nothing here may become false then.
 *
 * Model-facing text, with no eval cases yet: after a change, ask a real chat for an app.
 */
export const OZONE_CHAT_INSTRUCTIONS = `# Ozone chat

Ozone opened this folder for a conversation. The person may want an answer, some writing, a look at a file, a script, or anything else. Follow their lead.

- Answer directly and in plain language. Read this folder or run commands only when the request needs it.
- An attached file arrives as a path in the message. Read it from that path.
- Put files you make for the person in this folder, and tell them what you made.

## When the person asks for an app

Ozone builds web apps from a tested template, runs them in Docker and keeps their data safe. Do not write a new app in this folder. When the person asks for an app, a site or a tool with a screen:

1. Call \`ozone_app_create\` on the \`t3-code\` MCP server with a short name for it.
2. Call \`t3_thread_launch\` with the \`projectId\` it returned, a short \`title\`, and the person's request in their own words as \`message\`.
3. Give the person the \`link\` it returned and stop. That thread builds the app.

In Claude Code these tools load on demand. Load them with ToolSearch \`select:mcp__t3-code__ozone_app_create,mcp__t3-code__t3_thread_launch\`.
`;

/** Claude Code reads CLAUDE.md, every other provider AGENTS.md. One text serves both. */
const CLAUDE_MD = "@AGENTS.md\n";

/**
 * Puts the instructions into a chat's new folder. A chat works without them, so a failure is
 * logged and the thread starts anyway.
 */
export const writeInto = (fileSystem: FileSystem.FileSystem, path: Path.Path) =>
  Effect.fn("ChatPersona.writeInto")(function* (folder: Option.Option<string>) {
    if (Option.isNone(folder)) return;
    yield* Effect.all([
      fileSystem.writeFileString(path.join(folder.value, "AGENTS.md"), OZONE_CHAT_INSTRUCTIONS),
      fileSystem.writeFileString(path.join(folder.value, "CLAUDE.md"), CLAUDE_MD),
    ]).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Ozone could not write a chat's instructions.", {
          folder: folder.value,
          cause,
        }),
      ),
    );
  });
