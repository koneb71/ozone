# Cursor

Ozone runs Cursor agents on the environment's machine, in the workspace of the thread you
selected. Cursor cloud agents are not available.

## Prerequisites

- Sign in with Cursor in **Settings > Providers > Cursor**, or provide a Cursor API key in
  `CURSOR_API_KEY`.
- A paid Cursor plan on the account used for browser sign-in or `CURSOR_API_KEY`.

## Sign in

Choose **Sign in**, then open the sign-in page and complete it in your browser. Ozone
updates automatically when sign-in finishes. This works when connected to a remote environment too.

Each provider instance keeps its own login on the environment that runs it. Your Cursor editor and
CLI login are separate. A configured `CURSOR_API_KEY` overrides browser sign-in; remove that override
to use the browser flow.

Use **Change account** or **Sign out** in the same settings section. Both stop that
instance's running threads and keep their history. Sign-out forgets the saved credential; to revoke
the generated key before it expires, remove it from your Cursor dashboard's API keys.

## MCP servers and plugins

Custom Cursor MCP servers and plugins are not configured in Ozone. They load from the environment
machine's Cursor config when the agent opens: project `.cursor/mcp.json`, user `~/.cursor/mcp.json`,
and installed plugins under `~/.cursor/plugins`. Plugin tools can appear without a login; OAuth MCP
servers still need credentials. Run `agent mcp login <server>` from the project's root folder.
Signing in to a server from the Cursor editor does not carry over, and Cursor cannot complete an
interactive MCP sign-in during an Ozone run. After you add or change skills, plugins, or MCP
servers, or after a successful CLI login, use **Restart agent session**.

## What works

- Creating and resuming Cursor threads, and changing the model and its options between turns.
- Assistant text, reasoning, tool activity, plans, and todos.
- Image attachments.
- Stopping, queued messages, and steering a running turn.
- Cursor `task` subagents, shown as read-only child threads with their tool activity and final
  result. Send messages from the parent thread.

The model `auto` uses Cursor's default model selection.

Cursor has no native fork or rewind, and does not ask Ozone for approvals. A text-only steer
reaches the current run without restarting it. When Cursor cannot deliver the steer, the same
message is queued for the next turn after this run finishes. If you press Stop, that follow-up
stays held until you resume the queue. Steers with attachments, and provider or runtime changes
that must apply immediately, interrupt and restart the run.

Forking a Cursor thread starts a fresh Cursor agent with a portable handoff of the thread. Handoffs
summarize eligible timeline items and can omit the end of long messages. Read
[Context in portable handoffs](./portable-handoffs.md) before using a fork for work whose exact
instructions must carry forward.

## Permissions

Full access disables Cursor's sandbox; the other modes normally enable it. On Windows, Auto and
Supervised run without filesystem isolation when Cursor Auto-review is enabled, because Cursor has
no filesystem sandbox there. The other restricted modes, including the default Auto-accept edits
mode, cannot start on Windows.
