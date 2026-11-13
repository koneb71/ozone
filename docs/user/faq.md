# FAQ

## Is Ozone a harness?

No. A harness is what turns an LLM into an agent: it gives the model tools, runs them, and hands the results back. Claude Code and Codex are harnesses with their own interfaces. Ozone uses those harnesses and does not work without one.

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, Kiro, Pi, Muse Code, or fx. [Provider setup](./install.md#providers)

## Can I use Ozone with my Claude Code subscription?

Yes.

## How much does Ozone cost?

Nothing. Ozone is free and open source (MIT). You still pay your provider as you already do. [Install](./install.md)

## How do I use Ozone remotely?

Your agents run wherever Ozone runs: your desktop, a server, a VPS. Run `ozone up` on that machine, then connect from a browser or another desktop app over your local network, Tailscale, or SSH. [Remote access](./remote-access.md)

## How do I use Ozone on my phone?

Open a pairing link in your phone's browser. The phone is a remote. Your computer does the work and needs to stay on. [Remote access](./remote-access.md)

## Can I add several accounts for one provider?

A separate work account is fine: add another provider instance for it. See [Codex](./providers-codex.md) and [Claude](./providers-claude.md). Ozone does not switch between accounts on its own. If you manage a larger pool outside Ozone with a CLIProxyAPI hub, Ozone can show its pooled limits under Usage. [Connect a hub](./usage.md#connect-a-cliproxyapi-hub)

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in Settings and give it its own keys and endpoint. Your subscription setup stays untouched. [Claude](./providers-claude.md) · [Provider instances](./install.md#providers)

## Does my code go to Ozone's servers?

No. Your code and prompts go from your machine to your provider (Anthropic, OpenAI, and so on). Ozone collects no usage data.

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees** and turn on automatic worktree cleanup. You can also run it now from there. [Storage cleanup](./project-settings.md#storage-cleanup)

## Is there voice input?

Yes. Choose an environment to transcribe with first. The transcript goes into your draft for review. See [Voice input](./voice-input.md).

## Does it work on Windows, Mac, and Linux?

Yes. Builds are published for Windows x64, macOS on Apple silicon, and Linux x64. [Install](./install.md)

## Why is my provider not showing up?

Almost always, the CLI is not installed or not on the `PATH` of the machine that runs the server. Log in on that machine first, for example with `codex login` or `claude auth login`. Still missing? Point **Binary path** at it in provider settings. Version managers often cause this. [Provider setup](./install.md#providers)
