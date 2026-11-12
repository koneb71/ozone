# Ozone fork rules

This repository is Ozone, a tracked fork of T3 Code. Everything in the root `AGENTS.md` applies.
These rules come first where they differ.

- Read [docs/ozone/README.md](./README.md) before changing an upstream file.
- New behaviour goes in an Ozone module: `apps/server/src/ozone/`, `apps/web/src/ozone/`,
  `apps/mobile/src/ozone/`, `packages/contracts/src/ozone*.ts`,
  `packages/client-runtime/src/state/ozone.ts`, `packages/ozone-templates/`, or a script or
  workflow named `ozone-*`.
- An edit to any other file is a seam. Keep it to the registration itself, tag it with a comment
  containing `ozone-seam`, and add the file to [docs/ozone/SEAMS.md](./SEAMS.md).
- Never rename upstream packages, `T3CODE_*` variables, the `t3-code` MCP key, URL schemes or
  storage keys.
- User-facing copy says Ozone. Identifiers keep upstream's names.

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
