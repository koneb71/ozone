# Ozone

Ozone is an app builder and a client for coding agents. Describe an app and Ozone creates it from a template, runs it with Docker Compose, hands the work to coding agents, checks every step itself and shows a live preview. A Node WebSocket server wraps provider CLIs and agents (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Kiro and others) and serves web and desktop clients.

## What Ozone never compromises on

### 1. Local first

Ozone runs on the user's machine with the user's own provider accounts. Nothing it does by itself may send data to a service the user did not set up: no analytics, no hosted relay, no lookups against third parties for convenience. A feature that needs an outside service names it, and stays off until the user configures it.

### 2. App data is never lost

No code path may remove a Docker volume except a person-confirmed **Delete app** or **Delete deployment**, each after a snapshot. Read [data safety](docs/ozone/data-safety.md) before touching `apps/server/src/ozone/runtime`, `apps/server/src/ozone/data` or `apps/server/src/ozone/deploy`.

### 3. Performance

Users drive agents all day. Regressions usually come from sending too much data over WebSockets, CSS animations that spike the GPU, and lists that are expensive to render. Consider the cost of every change.

### 4. Remote ready

A client can control a server on another machine: over the local network, over Tailscale, or through SSH. New features must work when the client and the server are not the same machine.

### 5. Two surfaces

**Web** is the client the `ozone` command serves. **Desktop** is an Electron app that wraps the web client, bundles the server, and can host it for other clients. A feature belongs on both unless it needs the desktop shell.

## How to work here

Understand the real constraint, then build the smallest model that makes the correct behavior unsurprising. Do not preserve complexity because it already exists, and do not add machinery because it looks impressive. Fight scope creep.

These instructions are good defaults, not hard rules. The developer's preferences override anything here.

Most changes to Ozone come from agents running inside Ozone, often controlled remotely. Be careful about reading data, killing dev servers, and anything else that could damage the Ozone instance the developer is using.

## Glossary

- **you** means the agent reading this file and changing Ozone.
- **user** means the person using Ozone to direct coding agents.
- **agent** means the coding agent a user runs inside Ozone. Depending on context, that may also include you.
- **provider** means the agent runtime or harness Ozone talks to, such as Codex, Claude, Cursor, or OpenCode.
- **client** means the web or desktop UI.
- **environment** means one running server and the machine, filesystem, provider credentials, and state it owns.
- **project** means an environment-local workspace record rooted at a directory.
- **thread** means the durable conversation and work history for a project.
- **turn** means one user-to-agent cycle, including follow-up work such as checkpointing.
- **data home** means the base data directory, `~/.ozone` by default. Runtime state normally lives below its `userdata` directory.
- **app** means a project Ozone created from a template and runs with Docker Compose.
- **build** means the persisted spec, task plan and evidence that belong to one lead thread.
- **lead** means the agent thread that owns a build. A **worker** is a delegated child of the lead.
- **gate** means a check the server runs itself: typecheck, lint, tests, health.
- **snapshot** means a restorable copy of an app's data, stored outside its workspace.

More terms: [glossary](docs/internals/glossary.md).

## Names

Everything a person reads says Ozone, and the command is `ozone`. Internal identifiers keep their names, because existing installs have saved them: the `@t3tools/*` packages, storage keys, the `t3code://` scheme, `t3.json`, the `t3_*` MCP tool names, the `t3-code` MCP server key, the `t3code/` lint rules, and a worktree's `.t3` directory. Do not rename them. Environment variables a person sets are the exception: they are `OZONE_*`. The `T3_*` variables Ozone sets for its own child processes, such as `T3_MCP_URL` and `T3_SERVICE_LAUNCHER_CONTEXT`, are internal and keep their names.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine may run several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port (`ss -H -ltnp` on Linux, `lsof -nP -iTCP:<port> -sTCP:LISTEN` on macOS) after confirming its working directory is your worktree.
2. **Writing to the live install.** `~/.ozone/userdata` is the developer's real Ozone database, in use while you work. Reading it and copying from it are fine, and a good way to get real test data (see Test data). Never start a server against it, never open it read-write, never clean it up. In the main checkout, never set `OZONE_HOME=~/.ozone` for a dev server: that selects the live database.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies the backend. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from the chat view is usually also reachable from Settings, the command palette, and a keybinding. Fixing one is not fixing the feature.
- **Clients.** Web and desktop (wraps web, adds Electron shell/IPC). Shared logic lives in `packages/client-runtime`.
- **Providers.** Each provider has an adapter or a driver package (`apps/server/src/orchestration-v2/Adapters`, `packages/provider-*`). Provider-shaped features need a decision per provider, even if the decision is "not supported here".
- **Agents.** A capability a user can trigger is usually one an agent should reach through MCP tools, and scheduled tasks run the same paths. That only works when it is a service method, not handler code.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and the server, web, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Connection modes.** A local server, a paired server on the network or tailnet, and an SSH remote behave differently. Multi-device and multi-environment cases are real.
- **Docs and changelog.** Fix every doc the change made inaccurate and add a `CHANGELOG.md` line for anything a user will notice, in the same commit. See [Documentation](#documentation) and [Changelog](#changelog).

## Dev servers

- `vp i` installs. Worktrees get this from the `t3.json` setup script; if module resolution looks broken, it probably did not run.
- Setup runs in the background. While `.t3/setup-running` names a live PID, wait for it and do not run `vp i`. It ends with `.t3/setup-done` or `.t3/setup-failed` (with the error tail). With no marker at all, setup never ran here, so run `vp i` yourself.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored `.t3`, which deliberately outranks an ambient `OZONE_HOME` so you cannot land on shared state by accident. An explicit `--home-dir` still wins. The main checkout keeps dev state in `~/.ozone/dev`.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from the `[dev-runner]` line since occupied ports shift.
- Sharing over the tailnet is three steps: run `vp run dev --share` in the background, wait for the `pairingUrl:` line in its output, then give that full URL to an unpaired browser. Do not wire up `tailscale serve` by hand, open the URL yourself, or consume the user's pairing link. A browser with the reusable dev cookie can use the bare origin. If a normal one-time token was consumed, mint a fresh one with `node apps/server/src/bin.ts pair`. It carries standard scopes, while the startup URL carries admin scopes needed for Connections settings.
- To reuse web dev auth across worktrees, configure one fixed `OZONE_DEV_AUTH_TOKEN` in the main checkout's gitignored `.env`. The `t3.json` setup links that file into worktrees. Never commit or publish the token or a startup URL. See [Reusable dev credential](docs/operations/development.md#reusable-dev-credential).
- Stop what you started, by the PID you tracked. See rule 1. `vp` does not pass SIGTERM on, so signalling the `vp run dev` PID alone leaves Vite and the server running. Stop the background task with your harness's own stop, which ends the whole tree.
- Run dev servers and builds from your own shell so they end with your session. Do not detach them with `systemd-run`, `nohup`, `setsid`, or `tmux` unless the user asks for one that outlives the session. Detached servers ran for weeks and filled RAM and swap. The dev runner stops itself above `--memory-limit-gb` (half of RAM, at most 16 GiB) on Linux.
- Need a second checkout? `git worktree add` it next to this worktree, not in `/tmp`. Remove it when done.

## Test data

An empty database is a bad test. Seed your worktree's `.t3` with a copy of real data instead of pointing at live state:

- The first `vp run dev` in a worktree does this for you when its database is missing and the source is at most 500 MiB. Larger sources warn and dev starts with an empty database. `--no-seed` or `OZONE_DEV_SEED=0` skips seeding. Manual migration still accepts larger sources and may use substantial disk space before pruning.
- Run `vp run migrate-dev-db` with your dev server stopped to refresh. It rebuilds `<worktree>/.t3/userdata/statev2.sqlite` from a read-only snapshot of `~/.ozone/userdata/statev2.sqlite`, the developer's real data. It keeps recent projects and their stopped threads, and drops scheduled tasks, pending work, auth sessions, and links to other environments, so your dev server never runs the developer's agents or reaches their other machines. Raise `--projects` and `--threads-per-project` for more data.
- Bring `secrets` and `settings.json` only if the flow under test needs them.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Before you push, run `vp run check:changed`. It runs CI's fast checks for changed files: format, lint, knip, typecheck of affected packages and dependents, tests beside changes, and the cross-file checks those miss. CI runs the whole web suite and the app builder's tests (`apps/server/src/ozone`, `apps/web/src/ozone`). It runs no other tests: for the rest of the server, the desktop app, the packages and the scripts, run the test folders you touched.
- While you iterate, run `vp test run <files>`. For big files, add `-t "<name>"`.
- Use `vp run typecheck`; it caches per package. Each package runs `effect-tsgo tsrs --noEmit`, the Rust TypeScript 7 checker with Effect's diagnostics built in. There is no `typescript` package to run.
- Run `node -e` snippets from `apps/server` or the owning package. `effect` does not resolve from the repo root.
- Test behavior that can break, such as orchestration and event-sourcing, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an assertion there. Write a new `it` only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test, at each call site, or in two clients' copies of the same logic.
- Write a browser test only for behavior that needs a real browser: layout and scrolling, focus and pointer input, real workers, or a component wired to its hooks. Logic a component calls gets a unit test beside it (`*.logic.test.ts`). A browser test file spends seconds in CI loading its module graph before its first test runs; a unit test takes milliseconds.
- [Testing](docs/internals/testing.md) carries these same test rules, plus review guidance. Change both together.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. CI does not run them either, so the folders you touched are yours to run.
- Backend behavior changes ship with focused tests for that behavior.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test first (the fewest that fail on `main` for that reason, in an existing case of the module's test file where one fits), then the fix. Purely visual bugs (spacing, colour, alignment, a layout shift) get before/after captures as their proof and no test: do not add UI tests for nitpicks, and do not ask for one in review when a capture already shows it. A server-only fix with no visible surface ships the test plus a short runtime transcript. For a bug a user can reproduce in the web client, `vp run scenarios:prove` shows it failing on base and passing on the fix in the real app; see [Scenarios](docs/operations/scenarios.md).
- The server is event-sourced, and side effects run after the command commits. In tests, drain the effect worker (`OrchestrationEffectWorkerV2.drain`) or await the specific persisted event or `Deferred` that marks the milestone. Never wait on sleeps or polling. A test that needs a timeout to pass is wrong. Concretely:
  - `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`. `it.live` is wall-clock and only for subprocess or network fixtures.
  - No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or drain the worker.
  - No per-test timeout argument or `retry`. The project timeout is the ceiling, and flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - Browser tests assert through `expect.element` or `vi.waitFor`, never `requestAnimationFrame` or `transitionend`.
  - `vi.mock` factories must not spread a real module that pulls in Shiki or the diff workers.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
  - Lint enforces this: `t3code/no-test-timeout-or-unreasoned-skip`, `t3code/no-frame-waits-in-browser-tests`, `t3code/no-wall-clock-in-tests`, `t3code/no-real-time-wait-in-tests`, `t3code/no-polling-loop-in-tests`.
- Web browser tests are `*.browser.test.tsx` or `*.browser.test.ts` and render with `await using screen = await render(...)` from `apps/web/test/render.tsx`. `t3code/require-disposable-render` errors on the old patterns.
  - Acquire what the test drives after mounting (fake timers it advances, spies it sets up after mounting) after the render, so it disposes before the unmount. Anything the first render reads comes before it.
  - A helper that renders and then waits or clicks puts the screen in an `AsyncDisposableStack` and `move()`s it out only on success, so a failed wait still unmounts.
  - `rerender` needs a fresh element on every call.
  - No lifecycle hooks and no module-level mutable state. Shared mock state that `vi.mock` factories read is reset by a `setup()` call at the top of the test.
  - `router` is on by default. Pass `router: false` only with a one-line comment saying why.

  ```tsx
  it("saves on Enter", async () => {
    const onSave = vi.fn();
    using _now = vi.spyOn(Date, "now").mockReturnValue(0);
    await using screen = await render(<TitleEditor onSave={onSave} />, { router: "/threads/1" });
    await userEvent.type(screen.getByRole("textbox"), "Title{Enter}");
    expect(onSave).toHaveBeenCalledWith("Title");
  });
  ```

- User-visible frontend changes should get one integrated pass in a real client with the `test-t3-app` skill. The primary agent does this once after integrating. Subagents do not launch their own dev servers.

- Real agent turns cost money. To watch a turn stream through the pipeline and UI, use the free `Replay (dev)` provider that `vp run dev` registers; [test-t3-app](.agents/skills/test-t3-app/SKILL.md) shows how to start one. Use a real provider only when the change depends on that provider's behavior, and then pick its cheapest model, such as Haiku for Claude or Luna for Codex.

## Evals

`evals/` checks how real models behave with Ozone's model-facing text: agent instructions, MCP tool descriptions and schemas, and generated titles. Before you change that text, read [evals/README.md](evals/README.md) and run the evals it names. When you fix a model behavior bug, add a case that fails before the fix.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Pull requests go to [koneb71/ozone](https://github.com/koneb71/ozone).
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the developer asks. See [one problem per PR](CONTRIBUTING.md#one-problem).
- When babysitting from inside Ozone: call `watch_pull_request` and end your turn. Ozone wakes you on checks, comments, or conflicts. Do not poll or sleep. Verify each review finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new.

## Documentation

Every change updates the docs it affects, in the same commit, without being asked. Before you call work done, search `README.md` and `docs/` for the names and wording the change touched, not only the feature's own page, and fix every sentence that is now wrong. A change a user will notice updates its section in `docs/user/`, and `README.md` too when it changes what the README says Ozone does. Internal docs change when a decision or constraint they record changes. Agents can read the code for the rest, so most code changes need no internal doc.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds setup, release, and debugging procedures for people working on Ozone. Keep instructions for operating an installed Ozone server in the user guides.
- `docs/ozone/` records the decisions behind the app builder: apps, builds, data safety and deploys. The rules for `docs/internals/` apply to it.

## Changelog

[CHANGELOG.md](CHANGELOG.md) tells users what changed in each release. If it is missing, create it in the same layout.

- Every change a user will notice adds a line under `## Unreleased` in the same commit, under `### Added`, `### Changed`, `### Fixed` or `### Removed`. Add the subheading when it is not there yet.
- Write for the user: what they can do now, or what no longer goes wrong, in a sentence or two in the product's voice. No file paths, PR numbers, internal names or contributor tooling.
- Start a change that breaks an existing setup with `**Breaking:**` and say what to do about it.
- Refactors, tests, CI, internal docs and dev tooling get no line. A merge from T3 Code gets one line naming the upstream commit, plus a line for anything a user will notice.
- When a change that is not released yet is reworked or reverted, edit or remove its line instead of adding another.
- A release renames `## Unreleased` to `## <version> - <date>` and opens a new, empty `## Unreleased` above it. See [Release](docs/operations/release.md).

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. `.plans/` is gitignored only as a safety net for legacy tooling.
- Track active work in the GitHub issue that owns it.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## How it works

Clients send typed WebSocket requests. The server turns them into _commands_. The _orchestrator_ (`apps/server/src/orchestration-v2/Orchestrator.ts`) serializes commands and decides _events_ without doing any I/O. The _event sink_ commits those events, the _projections_ the UI reads, the _command receipt_, and _outbox_ effects in one transaction. The _effect worker_ then runs the effects, such as starting a provider turn or capturing a checkpoint, and feeds results back as commands. Provider CLIs run as subprocesses; per-provider _adapters_ translate their native protocols into orchestration events. Each turn ends with a _checkpoint_, a hidden git ref, so the app can diff and restore.

The app builder sits on top of that core and adds no state to it. A prompt on Home becomes an _app_; its first thread is the _lead_, which plans a _build_; the Build Conductor runs the plan with workers and checks each task inside the app's container.

Architecture and its constraints: `docs/internals/overview.md`. The app builder and its decisions: `docs/ozone/README.md`.

## Where code lives

- `apps/server` - WebSocket, orchestration, providers, checkpointing. Effect-heavy: read [Effect services](docs/internals/effect-services.md) before adding server code, and `.repos/effect/LLMS.md` for the Effect library itself.
- `apps/server/src/ozone` - apps, builds, the Docker runtime, data snapshots, deploys, Claude subscription sign-in. `apps/web/src/ozone` is its UI, `packages/contracts/src/ozone*.ts` its contracts, `packages/client-runtime/src/state/ozone.ts` its client state.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it.
- `packages/contracts` - Effect/Schema contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - connection and domain state shared by the clients.
- `packages/ozone-templates` - the templates every app starts from.
- `.repos/` - vendored read-only references. Prefer their patterns over invented ones. Never edit or import from them. Sync with `vp run sync:repos` when bumping the matching dependency. If it is missing (sparse checkout), read a file with `git show origin/main:.repos/<path>`.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Client mutations use `createEnvironmentRpcCommand`. Add protected methods to `CLIENT_GUARDED_RPC_SCOPES` in contracts and use the command's `permissionAtom` for UI availability. Grants are checked at execution against the destination environment; the server remains authoritative. Keep raw RPC clients inside `rpc/`, and extend the permission behavior tests when adding a protected method.
- Server features are services; transports stay thin. A `ws.ts` RPC handler, HTTP route, or MCP tool decodes input, calls one service method, and maps errors. See [Effect services](docs/internals/effect-services.md).
- `apps/web/src/components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent. `shadcn/no-restyle` fails lint on violations. See [Web UI](docs/internals/web-ui.md).
- Reusable Effect functions use `Effect.fn("Service.operation")` with a stable span name, not a
  function wrapping `Effect.gen`. Keep `Effect.gen` for inline programs and layer construction.
  Use `Effect.fnUntraced` only when spans would be too frequent (stream chunks, per-event
  projection, tight loops) or duplicate an existing tracing boundary; explain that choice nearby.
  Named `Effect.fn` creates a span; the unnamed form does not. Preserve existing span names and
  options, and pass combinators as additional function-builder arguments.
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names or signatures, narrate steps, record history, or explain the fix you just made; the PR carries that. `t3code/no-low-value-comments` enforces the length cap and the mechanical cases.
- React effects are for synchronizing with something outside React. Derive in render and act in handlers instead of syncing state, but don't hide real lifecycle work in refs or stores to dodge one. The `t3code/no-unreasoned-state-sync` lint rule reports every effect; one that stays states its reason with `// oxlint-disable-next-line t3code/no-unreasoned-state-sync -- <why>`.
- Users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
- Security matters, but do not over-index on it for dev-mode features.
