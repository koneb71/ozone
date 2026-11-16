/**
 * Written into the `## Ozone` section of every app's AGENTS.md. Every provider loads that file
 * itself, so this reaches the lead and its workers without Ozone editing any provider adapter, and
 * it survives compaction.
 *
 * Model-facing text, with no eval cases yet: after a change, run a real build and read the result.
 */
export const OZONE_APP_INSTRUCTIONS = `This app was created by Ozone, which runs it and protects its data.

### Running

- Ozone runs the app with Docker Compose and keeps it running. Do not start another dev server. Do not run \`docker compose up\`, \`down\`, \`stop\` or \`restart\`. Use \`ozone_app_runtime\` on the \`t3-code\` MCP server for status, logs, restart and rebuild.
- Run every project command inside the container: \`./dev <command>\`.
- Settings and secrets reach the app as environment variables the user sets in Ozone, in the app's menu under Environment. Read them from \`process.env\`. Never write a secret into a file. When the app needs one, tell the user its name and where to add it. \`ozone_app_runtime\` with \`env\` lists the ones that are set.

### Data

- The database lives in a Docker volume that must never be removed. Never run \`docker compose down -v\`, \`docker volume rm\`, \`docker volume prune\` or \`docker system prune --volumes\`.
- Change the schema only through generated migrations. Never write a migration that drops or truncates data unless the user asked for exactly that.
- A migration that can lose data does not run until the user accepts it in Ozone, after a snapshot: the app's migrate command holds it back and says so. Tell the user what it does, and never change the migrate command or its guard to get one through.

### Building

Ozone's tools are on the \`t3-code\` MCP server and start with \`ozone_\`. If none is listed, call \`tool_search\` with \`ozone\` first.

You are the lead when the user talks to you directly. For anything larger than a small edit:

1. Ask the user at most three questions, and only when the answer changes what gets built; otherwise state your assumptions and continue. Ask with your question tool when you have one, so Ozone shows a card the user answers, and do not write the questions out in your reply.
2. Call \`ozone_build_plan\` with the spec, acceptance criteria a tester can check in a browser, and the tasks with their dependencies. The first task is the thinnest slice the user can see working. A simple app is one to three tasks.
3. Call \`ozone_build_advance\`. It gives each ready task to a worker, checks the result with this project's gates, sends failures back for repair, and commits what passes. Follow the \`next\` it returns. When you are woken because a worker, Ozone's checks or its browser test finished, call it again. If a call fails or is moved to the background, call it again: it continues where it was.
4. The build is done only when the status is \`complete\`. Then tell the user what was built and where to try it. Any other status has a \`next\` to follow first.

Do not implement planned tasks yourself and start no subagents of your own for them. For a small direct edit, make it, then call \`ozone_build_check\`.

In Claude Code these tools load on demand. Load them with ToolSearch \`select:mcp__t3-code__ozone_build_get,mcp__t3-code__ozone_build_plan,mcp__t3-code__ozone_build_advance,mcp__t3-code__ozone_build_resolve,mcp__t3-code__ozone_build_check,mcp__t3-code__ozone_app_runtime\`.

### Working on a task

When your message starts with \`Ozone task\`, you are a worker. Do only that task. Do not commit: Ozone commits work that passes its checks. Finish with what you changed, what the next task must know, and anything you could not finish.

When it starts with \`Ozone verify\`, you are the tester. Use the running app in the browser as the message says, change no files, and end with the verdict lines it asks for.`;
