# Ozone

Describe an app and Ozone builds it, runs it and shows it to you. It creates the app from a tested
template, starts it with Docker Compose, hands the work to coding agents, checks every step itself
and opens a live preview beside the conversation. It also has a plain chat that takes files.

Ozone is a fork of [T3 Code](https://github.com/pingdotgg/t3code) and keeps everything T3 Code
does: threads, providers, checkpoints, the preview browser and remote access.

![A build thread: the plan with its repair task, the running app and its preview](docs/ozone/assets/build.png)

That thread started from one sentence: "A reading list. Add a book with its title and author, mark
it as read, and see how many are left to read." This is the app it built:

![The reading list app that the build produced](docs/ozone/assets/app.png)

## What it does

- **Builds apps from a prompt.** A new app is a real project on your disk, in a git repository of
  its own, started from a tested template: a **web app** (TanStack Start with React 19, Tailwind
  CSS 4, Drizzle on Postgres and Better Auth), a **landing page** with no database, or an **API**
  (Hono, Drizzle on Postgres and zod).
- **Runs them in Docker.** Each app is a Docker Compose project with one address that never
  changes. Start, stop, restart, rebuild and read its logs from the thread. Give it settings and
  secrets under **Environment**: they reach its container and never its code.
- **Orchestrates the work.** The Build Conductor turns a request into a task graph. A worker does
  each task. The server, not the agent, runs the type check, the linter and the tests inside the
  app's container. A failed check goes to a fresh worker with the evidence. Every task that passes
  is a commit. When every check passes, a tester uses the app in a browser against what you asked
  for.
- **Lets you steer.** Turn on "Show me the plan first" and the build starts only when you say so.
  Each app's Build settings choose the model its workers use, so a large lead can direct cheaper
  workers.
- **Keeps your data.** An app's database lives in a volume that only a confirmed **Delete app**
  removes, after a snapshot, and Home can bring a deleted app back with that data. Every finished
  task takes a snapshot, and **History** takes the code and the data back to any task, which you
  can undo the same way. A migration that can lose data waits until you apply it, after a snapshot.
- **Deploys.** **Deploy** runs the production build with a database of its own, on this machine or
  on a server that runs Docker, reached over SSH. Your development data is never touched, and Stop
  keeps the production data for the next deploy. Each deploy saves the production data first, and
  the Data dialog backs it up and restores it.
  - Give it a **domain** and it is served over HTTPS with a certificate from Let's Encrypt, and
    each new version takes over without the app going down.
  - **History** lists every deploy with its output, and rolls back to any of them, with the data
    from then if you ask.
  - **Monitor** shows each container's CPU, memory and network, and its logs. **Set up** checks a
    server, installs Docker there if it has none, and starts the proxy.
  - **Settings** deploys by itself when a build completes, gives the app a deploy URL to call from
    a script, and tells Slack, Discord, Telegram or any webhook how each deploy went.
- **Chats.** Ask anything and attach PDFs, Word documents, images and other files. Ask a chat
  for an app and it starts one.
- **Uses your subscription.** Sign in to Claude from Settings. No API key is involved, and an API
  key left in your shell is not used by accident. The other providers T3 Code supports work too.

## Run it

You need Docker with Compose, and [Claude Code](https://claude.com/product/claude-code) or another
supported provider on the same machine. Ozone tells you on its home screen when one is missing,
and how to get it.

### Install the desktop app

Download the latest build from [Releases](https://github.com/koneb71/ozone/releases/latest):

| Your computer              | File                                             |
| -------------------------- | ------------------------------------------------ |
| Mac with Apple silicon     | `Ozone-…-arm64.dmg`                              |
| Linux, 64-bit Intel or AMD | `Ozone-…-x86_64.AppImage` or `Ozone-…-amd64.deb` |

The builds are not signed. On a Mac, the first time, open **System Settings**, choose **Privacy &
Security** and press **Open Anyway** after macOS refuses to open Ozone. There is no Windows build
yet.

Ozone keeps its data in `~/.ozone` and can run beside T3 Code.

If no release is published yet, build the installers yourself: on GitHub, open **Actions**, choose
**Ozone release** and press **Run workflow**. The files are attached to the finished run.

### Run from source

Ozone builds with [Vite+](https://viteplus.dev/guide/), which also provides the right Node version.

```sh
curl -fsSL https://vite.plus | bash
vp i
vp run dev
```

Open the pairing URL the dev runner prints.

### Build your first app

1. Open **Settings**, choose **Providers** and sign in to Claude.
2. On the home screen, describe an app and press Enter.
3. Watch the plan run. The preview opens by itself when the app is up.

## How it works

Ozone's code lives in its own modules beside T3 Code's, and touches T3 Code's files only at small
tagged seams, so upstream changes keep merging.

- [Ozone and the fork](docs/ozone/README.md): how the parts fit, the fork rules, how to sync.
- [The Build Conductor](docs/ozone/orchestrator.md): the orchestrator and the decisions behind it.
- [Data safety](docs/ozone/data-safety.md): the contract that keeps an app's data.
- [Seams](docs/ozone/SEAMS.md): every upstream file Ozone edits, and why.

Everything else under [docs](docs/) is T3 Code's documentation, and it still applies.

## What is not Ozone yet

- The mobile app carries T3 Code's name and has no build of Ozone's own. It shows a thread's app,
  its controls, its build and its preview, and lists your apps under Settings, but this has not
  been tried on a device yet.
- The command-line tool is still called `t3`, and messages that come from the server can still say
  T3 Code.
- There is no Windows build, and Ozone is untested on Windows.
- Deploy is on the desktop and web apps only, and notifications cannot go to email yet.
- Ozone collects no usage data. The privacy policy and a few help links still lead to T3 Code's
  site.

## License

MIT, like T3 Code. See [LICENSE](LICENSE).
