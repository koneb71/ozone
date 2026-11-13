# Ozone rules

Ozone began as a fork of T3 Code and is now its own project: nothing is merged from T3 Code any
more. Everything in the root `AGENTS.md` applies. These rules come first where they differ.

- Ozone is local first. Nothing it does by itself may send data to a service the user did not
  set up: no analytics, no hosted relay, no lookups against third parties for convenience.
- Ozone's own features live in `apps/server/src/ozone/`, `apps/web/src/ozone/`,
  `packages/contracts/src/ozone*.ts`, `packages/client-runtime/src/state/ozone.ts` and
  `packages/ozone-templates/`. Read [docs/ozone/README.md](./README.md) for why they are shaped
  as they are.
- Everything a person reads says Ozone. Internal names from before the fork stay as they are:
  the `@t3tools/*` packages, `T3CODE_*` variables, storage keys, the `t3code://` scheme,
  `t3.json`, the `t3_*` MCP tool names and the `t3code/` lint rules. Renaming them would break
  what existing installs have saved.

## Vocabulary

- **app** means a project Ozone created from a template and runs with Docker Compose.
- **build** means the persisted spec, task plan and evidence that belong to one lead thread.
- **lead** means the agent thread that owns a build. A **worker** is a delegated child of the lead.
- **gate** means a check the server runs itself: typecheck, lint, tests, health.
- **snapshot** means a restorable copy of an app's data, stored outside its workspace.

## Data safety

Ozone must never lose an app's data. No code path may remove a Docker volume except the
user-confirmed "Delete app data" flow, which snapshots first. See
[data safety](./data-safety.md) before touching `apps/server/src/ozone/runtime` or
`apps/server/src/ozone/data`.
