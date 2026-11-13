# Ozone docs

## Using Ozone

The [root README](../README.md) introduces apps, builds and deploys. These guides cover the rest.

- [Install Ozone](./user/install.md)
- [Welcome page](./user/welcome-page.md)
- [Messages and context](./user/composer.md)
- [Files in question answers](./user/question-attachments.md)
- [Working with threads](./user/thread-sidebar.md)
- [Threads from older versions](./user/thread-migration.md)
- [Activity log](./user/activity-log.md)
- [Permission modes](./user/permission-modes.md)
- [Terminal history](./user/terminal.md)
- [Source control](./user/source-control.md)
- [Settings and project overrides](./user/project-settings.md)
- [Appearance and themes](./user/appearance.md)
- [Keybindings](./user/keybindings.md)
- [Keyboard focus](./user/keyboard-focus.md)
- [Voice input](./user/voice-input.md)
- [Text generation models](./user/text-generation.md)
- [SnapShots](./user/snap-shot.md)
- [Visual replies](./user/html-renders.md)
- [Prompt links](./user/prompt-links.md)
- [Context in portable handoffs](./user/portable-handoffs.md)
- [Import browser sessions](./user/browser-import.md)
- [Use Ozone as your default browser](./user/default-browser.md)
- [Devices](./user/devices.md)
- [Usage and limits](./user/usage.md)
- [Secrets](./user/secrets.md), with 1Password on a remote server through
  [Connect](./user/secrets-1password-connect.md) or a
  [service account](./user/secrets-1password-service-account.md)
- [Export diagnostics to your own receiver](./user/diagnostics-export.md)
- [Remote access](./user/remote-access.md)
- [Outside agents](./user/outside-agents.md)
- [Running Ozone in the background](./user/background-service.md)
- [Updating Ozone](./user/updating.md)
- [Managed policy](./user/managed-policy.md)
- [Open source licenses](./user/open-source-licenses.md)
- [FAQ](./user/faq.md)
- Provider guides: [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md) · [Cursor](./user/cursor.md) · [OpenCode](./user/providers-opencode.md) · [Antigravity](./user/providers-antigravity.md) · [Kiro](./user/providers-kiro.md) · [Pi](./user/providers-pi.md) · [Muse Code](./user/providers-muse.md) · [fx](./user/providers-fx.md) · [ACP providers](./user/providers-acp.md)

---

## Working on Ozone

Start with the [development runbook](./operations/development.md),
[AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

### The app builder

- [How Ozone is built](./ozone/README.md)
- [The Build Conductor](./ozone/orchestrator.md)
- [Data safety](./ozone/data-safety.md)

### The core

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Orchestration V2](./orchestration-v2/README.md)
- [Legacy orchestration migration](./internals/legacy-orchestration-migration.md)
- [Effect services](./internals/effect-services.md)
- [Testing](./internals/testing.md)
- [Performance regression checks](./internals/performance-regressions.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Remote architecture](./internals/remote.md)
- [Environment authentication](./internals/environment-auth.md)
- [Server updates](./internals/server-updates.md)
- [Provider constraints](./internals/providers.md)
- [Adding a provider](./internals/adding-a-provider.md)
- [Model manifest](./internals/model-manifest.md)
- [Context handoffs](./internals/context-handoffs.md)
- [Pull request file revisions](./internals/pull-request-file-revisions.md)
- [Assistant citations](./internals/assistant-citations.md)
- [Composer context references](./internals/composer-context-references.md)
- [Composer coordinates and serialization](./internals/composer-editors.md)
- [Web UI](./internals/web-ui.md)
- [Action names agree across presentations](./internals/consistency-action-names.md)
- [Terminal runtime](./internals/terminal-runtime.md)
- [Devices](./internals/devices.md)
- [Voice input](./internals/voice-input.md)
- [Linux window capture](./internals/linux-snap-shot.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Open source license notices](./internals/open-source-licenses.md)
- [Dev container](./internals/devcontainer.md)

### Runbooks

- [Development and local builds](./operations/development.md)
- [Scenarios: real-app proof for a fix](./operations/scenarios.md)
- [Live background-work verification](./operations/background-verification.md)
- [Release](./operations/release.md)
- [Observability](./operations/observability.md)
