# Ozone

Ozone is an app builder and chat client built as a tracked fork of
[T3 Code](https://github.com/pingdotgg/t3code) (MIT). T3 Code supplies the agent runtimes, the
event-sourced orchestration, threads, attachments, checkpoints and the preview browser. Ozone adds
the product on top: prompt-to-app building, a Docker Compose runtime that never loses app data, a
build orchestrator, a chat-first surface and in-app Claude subscription sign-in.

## How it fits together

A prompt on Home becomes an _app_: a project folder filled from a template in
`packages/ozone-templates`, committed, and started with Docker Compose. The app's first thread is
its _lead_. The lead plans a _build_, and the [Build Conductor](./orchestrator.md) runs it: workers
do the tasks, the server checks each one inside the app's container, and every task that passes
becomes a commit and a data _snapshot_. [Data safety](./data-safety.md) is the contract that keeps
an app's data through all of it.

A _chat_ is a thread without a project. Upstream gives each one a folder of its own. Ozone writes
the chat's instructions there, and an agent that is asked for an app in a chat creates one and
starts its lead thread.

## Decisions

- **Instructions travel in `AGENTS.md`.** An app's lead and workers, and a chat's agent, read
  Ozone's rules from the `AGENTS.md` in their folder. Every provider loads that file itself, so no
  provider adapter is edited and the rules survive compaction. Upstream can turn a chat's folder
  into a project in place, so a chat's text must stay true when that happens.
- **An app is a plain Compose project.** Nothing about it depends on the machine that made it, so
  hosting an app later means another environment that runs Docker, not a second runtime.
- **A deploy is a second Compose project.** `compose.prod.yaml` runs the production image as
  `<slug>-prod`, with a database volume of its own, so development data is never what people use.
  It is built from a clean copy of the last commit, made with a throwaway git index, so production
  never gets a worker's half-done files or the development `.env`.
  Ozone generates the database password and auth secret once and keeps them in its state: a
  Postgres volume keeps the password it was created with, so a settings file Ozone cannot read
  stops a deploy instead of being replaced. Migrations run from the build stage,
  which has the tools the production image leaves out. A server is reached with `docker -H ssh://`,
  so Ozone needs no agent there, only Docker and this machine's SSH access.
- **What an app is given stays out of its repository.** Its environment variables, Ozone's secrets
  and the host's certificate bundle reach Compose through override files in Ozone's state, which
  only their owner can read. A value is escaped for Compose, which would otherwise interpolate it.
- **Home hands files to the composer.** Upstream's composer owns attachment intake: conversion,
  compression and upload. Home opens a new chat and gives its files to that composer instead of
  preparing them a second way.
- **Upstream's tests build upstream's layers without Ozone.** Ozone's WebSocket handlers are read
  through a reference with a default, and its MCP tools are registered beside upstream's set, so
  no upstream test needs an Ozone service.

## Fork rules

1. **Beside, not inside.** Ozone code lives in its own modules:
   `apps/server/src/ozone/`, `apps/web/src/ozone/`, `packages/contracts/src/ozone*.ts`,
   `packages/client-runtime/src/state/ozone.ts`, `packages/ozone-templates/`, `docs/ozone/`, and
   any script or workflow whose file name starts with `ozone-`.
2. **Upstream files change only at seams.** A seam is the smallest edit that registers Ozone code
   with upstream code. Tag it with a comment containing `ozone-seam` and list the file in
   [SEAMS.md](./SEAMS.md). `apps/server/src/ozone/seams.test.ts` fails when the two disagree.
3. **Do not rename upstream identifiers.** Package names, the `T3CODE_*` environment prefix, the
   `t3-code` MCP server key, URL schemes and storage keys stay as they are. Renaming them buys
   nothing and turns every upstream merge into a conflict.
4. **Do not put Ozone state in the orchestration core.** `Orchestrator.ts`, `ProjectionStore.ts`
   and the V2 command and event unions are upstream's hottest files. Ozone composes upstream's public
   services instead and keeps its own tables.

## Syncing with upstream

```sh
git fetch upstream main
git merge upstream/main
```

`.github/workflows/ozone-upstream.yml` tries this merge every Monday without pushing anything. A
red run means the fork has drifted; its summary names the files that conflict.

- Conflicts should only appear in files listed in [SEAMS.md](./SEAMS.md). Keep upstream's side and
  re-apply the seam.
- A seam that replaces a line of upstream's can fall behind without conflicting. After a merge,
  compare `McpHttpServer.layer` with the server's own registration in `apps/server/src/server.ts`:
  a toolkit upstream adds to its layer, as it did `layerToolSearch`, must be added there too.
- Upstream's GitHub workflows are parked in `.github/workflows-upstream/` because they need
  upstream's runners and secrets. If a merge adds a file to `.github/workflows/`, move it there.
- Re-read `packages/provider-core/src/server/orchestrationInstructions.ts` after each merge. The
  build kickoff and worker briefs are written against that text.
- Run `vp run typecheck`, the Ozone tests and the web suite
  (`vp run --filter @t3tools/web test`), then the app once. A seam in the web client can break an
  upstream test far from the file it edits.

## Releasing

`.github/workflows/ozone-release.yml` builds the desktop app for Linux and Apple silicon, and the
command-line archive the app installs on a remote machine. It opens each desktop build before it
keeps it. A manual run leaves the files on the run. Pushing a `v<version>` tag also gathers them
into a draft release; publishing that draft is the release.

- The version comes from the tag. The workflow stamps it into the package files of its own
  checkout; never commit that.
- An installed desktop app looks for a newer version in this repository's releases, and a remote
  machine downloads its archive from there. Both need the repository to be public.
- Nothing is signed. Signing needs upstream's steps in `.github/workflows-upstream/release-desktop.yml`
  and certificates of Ozone's own.

## Traps

- Upstream's `.gitignore` ignores directories named `build`, `dist` and the like anywhere in the
  tree. An Ozone directory with such a name is invisible to git, the formatter, the linter and the
  unused-code check, so everything passes locally and the commit is missing files.
  `seams.test.ts` fails when that happens.
- Upstream's browser tests share one browser profile per worker, so a test can fail only on a
  machine with a different core count, from storage another file left behind. Reset the key in the
  failing test's own setup, as upstream's tests do.
- Browser tests need the Chromium build the repository's Playwright expects. Where another build
  is installed instead, set `OZONE_TEST_CHROMIUM` to its executable.
- Docker Compose builds through buildx bake, which refuses to read a file outside the project, such
  as the host's certificate bundle given as a build secret, and Compose has no flag to allow it.
  Ozone sets `BUILDX_BAKE_ENTITLEMENTS_FS=0` for a build that uses the bundle, and only then.
- A request is interrupted when its client disconnects. A restore, deletion or deploy that a
  person confirmed would stop halfway, so each runs in its service's own fiber and the request only
  waits for it.
- Every template is copied into each app made from it, and is checked by
  `apps/server/src/ozone/apps/templates.test.ts`. A template's lockfile, `src/routeTree.gen.ts` and
  formatting are produced by its own tools: change one in a copy with its placeholders filled in,
  run `npm install`, `npm run build` and `npm run format` there in a `node:26-alpine` container,
  and copy the results back with the placeholders restored. An installed Ozone reads them from
  `ozone-templates.json`, which the server build writes into `dist`: packagers drop dotfiles and
  file modes, and an app without its `.gitignore` would commit its `.env`.
- Text that agents read is code: the instructions in `apps/server/src/ozone/apps/appInstructions.ts`
  and `chat/chatPersona.ts`, the briefs in `builds/briefs.ts`, the tool descriptions in
  `mcp/tools.ts` and the template's `AGENTS.md`. An agent follows it literally. It has no eval
  cases yet, so after a change run a real build and read what the agents did.

## Defaults that differ from upstream

| Setting                            | Upstream                                   | Ozone        | Why                                                    |
| ---------------------------------- | ------------------------------------------ | ------------ | ------------------------------------------------------ |
| Product telemetry                  | on, sent to upstream                       | off          | a fork must not report to upstream's servers           |
| Release checks                     | upstream's npm package and GitHub releases | off          | Ozone is not that package                              |
| Data directory                     | `~/.t3`                                    | `~/.ozone`   | both can be installed on one machine                   |
| Default port                       | 3773                                       | 3737         | same reason                                            |
| Ambient `ANTHROPIC_API_KEY`        | passed to Claude                           | dropped      | subscription sign-in must not silently bill an API key |
| Project from the working directory | made when the server starts                | not made     | Home is the first screen                               |
| Threads without a project          | titled No project                          | titled Chats | they are Ozone's chats                                 |

Further reading: [orchestrator](./orchestrator.md), [data safety](./data-safety.md).
