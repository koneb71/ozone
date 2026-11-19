# How Ozone is built

Ozone is an app builder and a client for coding agents. It runs on the user's machine with the
user's own provider accounts. Underneath are the agent runtimes, the event-sourced orchestration,
threads, attachments, checkpoints and the preview browser that the
[architecture overview](../internals/overview.md) describes. This page covers what sits on top:
prompt-to-app building, a Docker Compose runtime that never loses app data, the build
orchestrator, the chat surface, deploys and in-app Claude subscription sign-in.

That code lives in `apps/server/src/ozone/`, `apps/web/src/ozone/`,
`packages/contracts/src/ozone*.ts`, `packages/client-runtime/src/state/ozone.ts` and
`packages/ozone-templates/`.

## How it fits together

A prompt on Home becomes an _app_: a project folder filled from a template in
`packages/ozone-templates`, committed, and started with Docker Compose. The app's first thread is
its _lead_. The lead plans a _build_, and the [Build Conductor](./orchestrator.md) runs it: workers
do the tasks, the server checks each one inside the app's container, and every task that passes
becomes a commit and a data _snapshot_. [Data safety](./data-safety.md) is the contract that keeps
an app's data through all of it.

A _chat_ is a thread without a project. Each one has a folder of its own. Ozone writes
the chat's instructions there, and an agent that is asked for an app in a chat creates one and
starts its lead thread.

## Decisions

- **Instructions travel in `AGENTS.md`.** An app's lead and workers, and a chat's agent, read
  Ozone's rules from the `AGENTS.md` in their folder. Every provider loads that file itself, so no
  provider adapter is involved and the rules survive compaction. A chat's folder can become a
  project in place, so a chat's text must stay true when that happens.
- **Design and SEO skills ship inside each app with pages.** The web-app and landing-page
  templates get `packages/ozone-templates/skills` copied to `.agents/skills` when the app is
  created (`templateTree` in `apps/server/src/ozone/apps/templates.ts`). No one skills folder
  reaches every provider, so the template's `AGENTS.md` names each `SKILL.md`, and every agent
  reads it from there. Six are copied from upstream (`scripts/lib/app-skills.ts` pins the commits
  and the files); `seo` is Ozone's own. Four of them, the looks Pick the design deals besides
  design-taste-frontend, are pinned to the last upstream commit that has them, and the template
  tells agents to use one only when `DESIGN.md` names it.
- **Web guidance is a server tool.** Chrome's Modern Web Guidance has an 11 MB index, and its own
  command fetches itself from npm on each run and sends the queries to Google. Ozone loads only
  its search module and offers it as `ozone_web_guidance`, which works offline, for every provider
  and for workers.
- **A design pick is `DESIGN.md`.** With "Pick the design" on, `BuildConductor.plan` saves no plan
  while the app has no `DESIGN.md` and tells the lead to call `ozone_design_propose`. The
  directions are structured data, not a provider's question card, so they look the same from every
  provider and the client can draw them. `BuildDesign` keeps them until the person answers, then
  writes the file itself, because a lead in plan mode cannot. The file, not a setting, records the pick, so it
  holds for later requests and the person can edit or delete it.
- **Ozone deals the looks; the lead fills them in.** Asked to choose freely, models keep landing
  on the same few safe looks. So the first `ozone_design_propose` call returns a deal from
  `builds/designDeal.ts`: a different taste skill per direction, with a palette and a type pairing
  from the taste library in Ozone's own copy of the skills, so it works before the app's container
  is up and for apps made before the skills shipped. The lead picks composition, material and
  motion from closed sets in `packages/contracts/src/ozoneBuild.ts` and writes the copy. Closed
  sets are what let the client draw every direction as a real first screen, in faces it bundles,
  with motion it controls (played once, never looping in Ozone's own UI).
- **`DESIGN.md`'s motion beats the skills' motion rules.** design-taste-frontend forbids tilt,
  flip, parallax and scroll reveals and keeps effects for tech pages. The person picked the motion,
  so `designFile` overrides those rules for the motion it names and says so in the file, and the
  template's Design section repeats it, because a worker reads the skill and runs its checker.
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
  so Ozone needs no agent there, only Docker and SSH access.
- **Servers are saved once, and reached with Ozone's key beside the person's own.** Ozone runs
  ssh with `<state>/ozone/ssh/config`, which adds its key and then includes `~/.ssh/config`, and
  Docker gets a PATH whose first `ssh` passes that file. So a server added with a pasted key or a
  one-time password works for every deploy, and one reached with the person's keys still does. The
  password goes to ssh through `SSH_ASKPASS` and is never written down.
- **Dokploy runs what Ozone hands it, from the app's Git remote.** Dokploy builds Compose from a
  clone; a pasted Compose file has no folder to build in. So Ozone pushes the commit to the
  branch's remote, and gives Dokploy its settings as a file mount, which Dokploy writes beside the
  clone and the deploy command adds with `-f`. Dokploy then owns the containers, the domain and
  the volumes, so snapshots, rollback, moving data and monitoring stay in Dokploy, and Ozone
  refuses a migration that can lose data there: it could not take a snapshot first. A private
  GitHub repository is cloned with an SSH key Ozone makes in Dokploy and adds to the repository as
  a read-only deploy key; Dokploy only uses a key for an SSH address, so Ozone hands it that form.
  The key is added with the `gh` command line's sign-in or a token in the environment, because
  the GitHub source-control driver keeps its credential to itself; without one, the deploy stops and shows
  the key to add by hand.
- **An app gets its Git remote from the Deploy page.** Apps start with no remote, and every
  target that clones one would fail on its first deploy. The page sees that before the deploy and
  offers the source-control publish flow as one button, private or public. The server still refuses a
  deploy with no remote, since agents and the deploy URL do not pass through the page.
- **A hosting platform runs the app from a token, one driver per host.** Railway, Render and Koyeb
  build the app's Dockerfile from its Git remote and run Postgres themselves; Vercel takes the
  commit's files as an upload and runs no database, so Ozone refuses it for an app that keeps data.
  The production image cannot run migrations, and hosts differ on running a command before a
  release, so Ozone applies them from this machine: the commit's own `migrate` service, pointed at
  the host's database through its outside address. That keeps the hold on a migration that can
  lose data. The host owns the service and the database, so the Dokploy rules apply: no snapshot,
  nothing deleted, no rollback or monitoring. What a host made is kept by id in the app's
  `hosted.json`, so a deploy never makes it twice. None of the four drivers has deployed to a real
  account yet; they follow each host's published API.
- **A domain goes through one proxy per host.** Ozone runs Traefik there as its own Compose
  project, `ozone-proxy`, on ports 80 and 443; an app with a domain drops its published port, joins
  the proxy's network and is routed by its labels. Without a port of its own, a second copy can
  start beside the first: a deploy waits until the proxy routes to the new copy, then stops the old
  one, and the proxy retries a request that reached the stopped copy within a second. Swarm and a
  registry, which other hosts use for this, would be machinery Ozone does not otherwise need.
- **A deploy URL is a token in a path.** It deploys the last commit where the app runs, with no
  session, as a Git host's deploy hook does. Notification channels and the token live in Ozone's
  state, readable only by its owner, and clients see neither again.
- **What an app is given stays out of its repository.** Its environment variables, Ozone's secrets
  and the host's certificate bundle reach Compose through override files in Ozone's state, which
  only their owner can read. A value is escaped for Compose, which would otherwise interpolate it.
- **An app's controls are one page, opened like Settings.** The route `/apps/…/<section>` renders
  in `AppRouteModal` with Settings' layout parts, so it looks like Settings and needs no entry
  in the Settings registry. Notifications sit there too, under "All apps", for that reason.
- **Home hands files to the composer.** The composer owns attachment intake: conversion,
  compression and upload. Home opens a new chat and gives its files to that composer instead of
  preparing them a second way.
- **The core's tests run without Ozone's services.** Ozone's WebSocket handlers are read through
  a reference with a default, and its MCP tools are registered beside the core set, so a test of
  the core needs no Ozone service.
- **Ozone keeps its state out of the orchestration core.** `Orchestrator.ts`, `ProjectionStore.ts`
  and the V2 command and event unions carry nothing about apps or builds. Ozone composes the
  core's public services and keeps its own tables.
- **Internal names stay as they are.** The `@t3tools/*` packages, storage keys, the `t3code://` scheme, `t3.json`, the `t3_*` MCP tool names, the `t3-code` MCP server key
  and the `t3code/` lint rules keep their names, because existing installs have saved them.
  Everything a person reads says Ozone. Environment variables are the exception: they are `OZONE_*`.
- **Releases are built on each platform's own runner.** Windows builds on Windows, so
  nothing is cross-compiled. Only the Mac app is signed. Each desktop build is opened before it is kept. See
  [Release](../operations/release.md).

## Defaults

| Setting                            | Value      | Why                                                    |
| ---------------------------------- | ---------- | ------------------------------------------------------ |
| Data directory                     | `~/.ozone` | one place for state, snapshots and Ozone's SSH key     |
| Default port                       | 3737       | the server's port when none is given                   |
| Ambient `ANTHROPIC_API_KEY`        | dropped    | subscription sign-in must not silently bill an API key |
| Project from the working directory | not made   | Home is the first screen                               |

## Syncing with T3 Code

Ozone shares history with [T3 Code](https://github.com/pingdotgg/t3code) and takes its
improvements by merging a pinned commit of its `main`:

```sh
git fetch upstream main
git merge --no-commit --no-ff <commit>
```

Upstream lands a few hundred commits a day, so merge often: the conflicts grow with the gap.

- **What stays removed.** The mobile app, marketing site, relay and T3 Connect, Clerk, `cloud`,
  guest sharing, triage, telemetry and analytics, the nightly and preview channels, the v1 thread
  import, upstream's GitHub workflows and its npm launcher. When upstream edits a file Ozone
  removed, keep it removed. Upstream also adds new files inside removed folders, and adds calls
  to removed features inside files that merge cleanly: neither conflicts, so look for both.
- **Everything else** starts from upstream's side with Ozone's change put back: its names, its
  removals, and its own features where they attach to upstream's code.
- **Names come back without a conflict.** After a merge, `git grep T3CODE_` must find only this line,
  and text a person reads must not say T3 Code. Tests that assert a message need the same rename
  as the code that prints it.
- **Package exports can vanish.** Removing exports next to one upstream adds makes git drop the
  new one from `packages/shared/package.json`. Compare its export list with upstream's.
- **MCP tools.** A toolkit upstream adds must be in `McpHttpServer.layerTools`, which is what the
  server registers.
- **Agent instructions.** Re-read `packages/provider-core/src/server/orchestrationInstructions.ts`.
  The build kickoff and worker briefs are written against that text.
- **Migrations keep upstream's numbers**, including ones for features Ozone removed, so the
  sequence never forks: 090 and 091 add T3 Connect tables and columns that nothing reads. Ozone
  adds no migrations of its own to that sequence.

## Traps

- `.gitignore` ignores directories named `build`, `dist` and the like anywhere in the tree. A
  source directory with such a name is invisible to git, the formatter, the linter and the
  unused-code check, so everything passes locally and the commit is missing files.
- Browser tests share one browser profile per worker, so a test can fail only on a machine with a
  different core count, from storage another file left behind. Reset the key in the failing
  test's own setup.
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
- The skills under `packages/ozone-templates/skills` are copied from upstream byte for byte.
  Change them only with `vp run sync:app-skills` after moving the pin in
  `scripts/lib/app-skills.ts`, and read the diff: their scripts run on the person's machine.
  The taste skill's scripts load three of its asset files; a sync that drops one breaks them.
- Text that agents read is code: the instructions in `apps/server/src/ozone/apps/appInstructions.ts`
  and `chat/chatPersona.ts`, the briefs in `builds/briefs.ts`, the tool descriptions in
  `mcp/tools.ts` and the template's `AGENTS.md`. An agent follows it literally. Only design
  directions have eval cases (`evals/mcp-tool-use/cases/design-directions.ndjson`), so after any
  other change run a real build and read what the agents did.

Further reading: [orchestrator](./orchestrator.md), [data safety](./data-safety.md).
