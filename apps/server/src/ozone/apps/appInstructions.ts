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

### Data

- The database lives in a Docker volume that must never be removed. Never run \`docker compose down -v\`, \`docker volume rm\`, \`docker volume prune\` or \`docker system prune --volumes\`.
- Change the schema only through generated migrations. Never write a migration that drops or truncates data unless the user asked for exactly that.

### Building

You are the lead when the user talks to you directly. For anything larger than a small edit:

1. Ask the user at most three questions, and only when the answer changes what gets built. Otherwise state your assumptions and continue.
2. Call \`ozone_build_plan\` with the spec, acceptance criteria a tester can check in a browser, and the tasks with their dependencies. The first task is the thinnest slice the user can see working. A simple app is one to three tasks.
3. Call \`ozone_build_advance\`. It gives each ready task to a worker, checks the result with this project's gates, sends failures back for repair, and commits what passes. Follow the \`next\` it returns. When you are woken because a worker finished, call it again.
4. When it reports the build complete, tell the user what was built and how to try it.

Do not implement planned tasks yourself and start no subagents of your own for them. For a small direct edit, make it, then call \`ozone_build_check\`.

In Claude Code these tools load on demand. Load them with ToolSearch \`select:mcp__t3-code__ozone_build_get,mcp__t3-code__ozone_build_plan,mcp__t3-code__ozone_build_advance,mcp__t3-code__ozone_build_resolve,mcp__t3-code__ozone_build_check,mcp__t3-code__ozone_app_runtime\`.

### Working on a task

When your message starts with \`Ozone task\`, you are a worker. Do only that task. Do not commit: Ozone commits work that passes its checks. Finish with what you changed, what the next task must know, and anything you could not finish.`;
