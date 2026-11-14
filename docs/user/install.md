# Install Ozone

Ozone runs coding agents on your computer and lets you control them from its
desktop app or a browser. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Ozone and configure providers afterwards.

## Desktop app

Download a build from [GitHub Releases](https://github.com/koneb71/ozone/releases):

| Platform             | File                 |
| -------------------- | -------------------- |
| macOS, Apple silicon | the `.dmg`           |
| Windows x64          | the `.exe` installer |
| Linux x64            | the `.AppImage`      |

The Mac app is signed and notarized by Apple. The Windows and Linux builds are
not signed, so Windows may warn you before the first launch.

### Linux

To launch the AppImage, open a terminal in its download folder. Replace
`Ozone.AppImage` below with the exact filename you downloaded:

```bash
chmod +x ./Ozone.AppImage
./Ozone.AppImage
```

### The `ozone` command

The desktop app includes the `ozone` command-line tool. A new install sets it up
on first launch; after an update, or any time, choose **Install** next to
**ozone command** in **Settings → About**. On macOS and Linux it adds an `ozone`
link in `~/.local/bin` (or `~/bin`); on Windows it adds the app's command folder
to your `PATH`. Open a new terminal afterwards. If the folder is not on your
`PATH`, **Add to PATH** on the Welcome page or in **Settings → About** adds one
line to your shell's startup file. **Remove** takes it off, and the app does not
add it again. If you already have another `ozone`, it stays as it is.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
ozone app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `ozone app ../my-project`, to open another directory. It
requires the desktop app, so a standalone server or an SSH session is not enough.
If the command cannot reach the app, start or update the desktop app and try
again.

## Command line

To run Ozone on a machine without the desktop app, such as a server, run the
installer. It downloads the release archive for the machine, checks it against
the release's checksums and installs the `ozone` command in `~/.local/bin`.

On macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/koneb71/ozone/main/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/koneb71/ozone/main/scripts/install.ps1 | iex
```

To install by hand instead, download
the `ozone-<version>-<platform>` archive for that machine from
[GitHub Releases](https://github.com/koneb71/ozone/releases). Archives are
published for Linux x64, macOS on Apple silicon, and Windows x64. Check the
download against the release's `SHA256SUMS` file, unpack it, and run this in the
unpacked folder:

```bash
./ozone install
```

This installs the `ozone` command. If its folder is not on your `PATH` yet, the
command says so and prints a line to add it.

| Task                                  | Command                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Start the server and open the web app | `ozone`                                                                    |
| Start the server without a browser    | `ozone serve`                                                              |
| Use it from your other devices        | `ozone up` ([details](./remote-access.md))                                 |
| Keep it running in the background     | `ozone service install` ([details](./background-service.md))               |
| Move to the newest release            | `ozone update`                                                             |
| Reclaim database space                | `ozone doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                       | `ozone uninstall`                                                          |

Run `ozone help` or `ozone --help` for the full reference. To start in a new
working directory, use an explicit path such as `ozone ./my-project`. A bare
directory name is accepted only if it already exists.

If `ozone` reports an already running server, connect to that server instead.
Stop it before starting a replacement, or use a different `--base-dir` for an
independent server.

Ozone keeps its data in `~/.ozone`.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from another computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| Kiro        | Install [Kiro CLI](https://kiro.dev/docs/cli/), then run `kiro-cli login`.                                                                                |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Ozone's provider settings.                                                                                           |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx          | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |

Provider CLIs must be on the server's `PATH`. If Ozone cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Ozone warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, mise, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or
the CLI's own update command when Ozone cannot tell. Claude, Codex, and
OpenCode installs Ozone cannot identify stay manual: update them through the
installer you used. Ozone runs `mise upgrade`
only for a tool your mise config requests as `latest` when the provider's binary
path is a mise shim or under the tool's `installs/<tool>/latest` link; update a
pinned version, or a path into one version's directory, through mise yourself.
Update a CLI installed with Nix through Nix.
Cursor and Antigravity update with Ozone. Homebrew and Chocolatey installs
compare against the version their package manager offers, which can trail the
npm release; update Claude installed with Chocolatey through Chocolatey.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Ozone does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Kiro](./providers-kiro.md),
[Pi](./providers-pi.md), [Muse Code](./providers-muse.md), and [fx](./providers-fx.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a host available.
- [Updating Ozone](./updating.md): update the app and connected servers.
- [Managed policy](./managed-policy.md): configure Ozone for everyone on a machine.
