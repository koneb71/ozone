# Seams

Every upstream file Ozone edits. `apps/server/src/ozone/seams.test.ts` checks this list against the
`ozone-seam` tags in the repository, in both directions. Keep the reason to one line.

## Tagged

These files contain a comment with `ozone-seam` at each edit.

| File                                                                    | Why                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`                       | expects Ozone's name and profile folders                                                               |
| `apps/desktop/src/app/DesktopClerk.test.ts`                             | expects Ozone's profile folders                                                                        |
| `apps/desktop/src/app/DesktopEarlyElectronStartup.ts`                   | the Linux launcher is named for Ozone                                                                  |
| `apps/desktop/src/app/DesktopEnvironment.test.ts`                       | expects Ozone's data folder                                                                            |
| `apps/desktop/src/app/DesktopEnvironment.ts`                            | the desktop app's name and Windows identity                                                            |
| `apps/desktop/src/app/DesktopLegacyLocalStorage.ts`                     | T3 Code's old profiles are not imported                                                                |
| `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts`                  | expects Ozone's launcher name                                                                          |
| `apps/desktop/src/app/DesktopStatePaths.ts`                             | the desktop app keeps its data in `~/.ozone`                                                           |
| `apps/desktop/src/app/DesktopUserData.test.ts`                          | expects Ozone's profile folders                                                                        |
| `apps/desktop/src/app/DesktopUserData.ts`                               | a browser profile of its own, so it can run beside T3 Code                                             |
| `scripts/build-desktop-artifact.ts`                                     | product name, and the staged package rewritten for Ozone                                               |
| `apps/mobile/src/Stack.tsx`                                             | registers the Apps page and the build's task list                                                      |
| `apps/mobile/src/features/layout/workspace-overlay-routes.ts`           | the build's task list opens over the thread                                                            |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`             | Settings lists Apps first                                                                              |
| `apps/mobile/src/features/settings/components/settings-page-targets.ts` | names the Apps page as one a Settings row opens                                                        |
| `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`               | shows a thread's app and its build above the composer                                                  |
| `apps/server/scripts/cli.ts`                                            | the server build writes the template bundle into `dist`                                                |
| `apps/server/src/auth/RpcAuthorization.ts`                              | spreads the scopes of Ozone's RPC methods into the scope map                                           |
| `apps/server/src/cli/app.test.ts`                                       | expects Ozone's default data directory name                                                            |
| `apps/server/src/cli/browser.ts`                                        | browser setup under sudo uses the Ozone data directory                                                 |
| `apps/server/src/cli/config.test.ts`                                    | expects Ozone's default port                                                                           |
| `apps/server/src/cli/config.ts`                                         | no project is made from the working directory by default                                               |
| `apps/server/src/cloud/npmRelease.ts`                                   | keeps upstream's unused release layer exported                                                         |
| `apps/server/src/config.ts`                                             | default port 3737                                                                                      |
| `apps/server/src/environment/ServerEnvironment.ts`                      | the triage agent, which reports to upstream's repository, is off                                       |
| `apps/server/src/mcp/McpHttpServer.ts`                                  | keeps upstream's unused MCP layer exported                                                             |
| `apps/server/src/observability/RpcInstrumentation.ts`                   | spreads the trace labels of Ozone's RPC methods                                                        |
| `apps/server/src/os-jank.ts`                                            | default data directory `~/.ozone`                                                                      |
| `apps/server/src/project/ManagedProjectFolders.test.ts`                 | expects the Chats title                                                                                |
| `apps/server/src/project/ManagedProjectFolders.ts`                      | the project of project-less threads is titled Chats, and a chat's new folder gets Ozone's instructions |
| `apps/server/src/provider/Drivers/ClaudeDriver.ts`                      | attaches Claude subscription sign-in and advertises it in snapshots                                    |
| `apps/server/src/provider/Drivers/ClaudeHome.ts`                        | drops ambient Anthropic API-key variables from the host environment                                    |
| `apps/server/src/server.ts`                                             | provides `Ozone.layer`, registers Ozone's MCP tools and its deploy URL                                 |
| `apps/server/src/telemetry/AnalyticsService.ts`                         | telemetry off, with no upstream key or host                                                            |
| `apps/server/src/ws.ts`                                                 | Ozone's release lookup and WebSocket handlers                                                          |
| `apps/web/index.html`                                                   | product name on the splash screen                                                                      |
| `apps/web/src/branding.ts`                                              | product name                                                                                           |
| `apps/web/src/components/ChatView.tsx`                                  | an app's notices, and files handed over from Home, reach the composer                                  |
| `apps/web/src/components/CommandPalette.browser.test.tsx`               | resets a storage key another test file can leave behind                                                |
| `apps/web/src/components/CommandPalette.tsx`                            | names the project-less entries Chats and New chat                                                      |
| `apps/web/src/components/T3Wordmark.tsx`                                | renders the Ozone mark wherever upstream shows its wordmark                                            |
| `apps/web/src/components/chat/ChatHeader.tsx`                           | a chat's breadcrumb says Chats                                                                         |
| `apps/web/src/components/chat/DraftHeroHeadline.tsx`                    | a new chat's project picker says Chats                                                                 |
| `apps/web/src/components/chat/useComposerSend.ts`                       | sending a prompt no longer counts towards upstream's star prompt                                       |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`                     | sidebar brand name                                                                                     |
| `apps/web/src/routes/_chat.index.tsx`                                   | the index route shows Ozone's home                                                                     |
| `apps/web/src/state/managedPolicy.ts`                                   | usage-data notices say Ozone collects none                                                             |
| `apps/web/vite.config.ts`                                               | registers the build-time rename to Ozone, and `OZONE_TEST_CHROMIUM` for tests                          |
| `knip.jsonc`                                                            | finds the scripts upstream's parked workflows still name                                               |
| `packages/client-runtime/src/rpc/client.ts`                             | lists Ozone's streaming RPC methods beside upstream's                                                  |
| `packages/client-runtime/src/state/commandPermissions.test.ts`          | checks that an Ozone action needs its right on the client                                              |
| `packages/client-runtime/src/state/projectGrouping.test.ts`             | expects the Chats label                                                                                |
| `packages/client-runtime/src/state/projectGrouping.ts`                  | the group of project-less threads is labelled Chats                                                    |
| `packages/contracts/src/clientRpcPermissions.ts`                        | Ozone's actions are disabled on a client without the right to run them                                 |
| `packages/contracts/src/index.ts`                                       | exports Ozone's contracts                                                                              |
| `packages/contracts/src/rpc.ts`                                         | adds Ozone's RPC methods to the WebSocket group                                                        |
| `packages/shared/src/cliRelease.ts`                                     | release archives come from Ozone's repository                                                          |
| `scripts/build-cli-archive.ts`                                          | the CLI archive carries the template bundle beside the executable                                      |
| `scripts/notify-discord-release.test.ts`                                | reads upstream's release workflow from its parked location                                             |
| `vite.config.ts`                                                        | keeps formatter, linter and test runner out of template sources                                        |

## Untagged

These files cannot carry a comment, or were moved or replaced rather than edited.

| File                                                                | Why                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                         | also imports `docs/ozone/AGENTS.md`                                                             |
| `README.md`                                                         | replaced with Ozone's; upstream's is in its own repository                                      |
| `.github/workflows-upstream/`                                       | upstream's workflows, moved out of `.github/workflows/` so GitHub does not run them             |
| `apps/desktop/package.json`                                         | product name                                                                                    |
| `apps/desktop/resources/linux/io.github.koneb71.ozone.metainfo.xml` | Ozone's AppStream file, added beside upstream's                                                 |
| `apps/server/package.json`                                          | adds the `ozone` bin beside `t3`                                                                |
| `apps/web/public/manifest.webmanifest`                              | product name                                                                                    |
| `assets/`                                                           | icon files replaced in place with the Ozone icon set (the `.icon` sources are still upstream's) |
| `apps/web/public/`                                                  | the web copies of those icons                                                                   |
| `packages/client-runtime/package.json`                              | exports `./state/ozone`                                                                         |
