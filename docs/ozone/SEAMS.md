# Seams

Every upstream file Ozone edits. `apps/server/src/ozone/seams.test.ts` checks this list against the
`ozone-seam` tags in the repository, in both directions. Keep the reason to one line.

## Tagged

These files contain a comment with `ozone-seam` at each edit.

| File                                                        | Why                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/server/src/auth/RpcAuthorization.ts`                  | spreads the scopes of Ozone's RPC methods into the scope map                                           |
| `apps/server/src/cli/app.test.ts`                           | expects Ozone's default data directory name                                                            |
| `apps/server/src/cli/browser.ts`                            | browser setup under sudo uses the Ozone data directory                                                 |
| `apps/server/src/cli/config.test.ts`                        | expects Ozone's default port                                                                           |
| `apps/server/src/cli/config.ts`                             | no project is made from the working directory by default                                               |
| `apps/server/src/cloud/npmRelease.ts`                       | keeps upstream's unused release layer exported                                                         |
| `apps/server/src/config.ts`                                 | default port 3737                                                                                      |
| `apps/server/src/mcp/McpHttpServer.ts`                      | keeps upstream's unused MCP layer exported                                                             |
| `apps/server/src/observability/RpcInstrumentation.ts`       | spreads the trace labels of Ozone's RPC methods                                                        |
| `apps/server/src/os-jank.ts`                                | default data directory `~/.ozone`                                                                      |
| `apps/server/src/project/ManagedProjectFolders.test.ts`     | expects the Chats title                                                                                |
| `apps/server/src/project/ManagedProjectFolders.ts`          | the project of project-less threads is titled Chats, and a chat's new folder gets Ozone's instructions |
| `apps/server/src/provider/Drivers/ClaudeDriver.ts`          | attaches Claude subscription sign-in and advertises it in snapshots                                    |
| `apps/server/src/provider/Drivers/ClaudeHome.ts`            | drops ambient Anthropic API-key variables from the host environment                                    |
| `apps/server/src/server.ts`                                 | provides `Ozone.layer` and registers Ozone's MCP tools                                                 |
| `apps/server/src/telemetry/AnalyticsService.ts`             | telemetry off, with no upstream key or host                                                            |
| `apps/server/src/ws.ts`                                     | Ozone's release lookup and WebSocket handlers                                                          |
| `apps/web/index.html`                                       | product name on the splash screen                                                                      |
| `apps/web/src/branding.ts`                                  | product name                                                                                           |
| `apps/web/src/components/ChatView.tsx`                      | an app's notices, and files handed over from Home, reach the composer                                  |
| `apps/web/src/components/CommandPalette.browser.test.tsx`   | resets a storage key another test file can leave behind                                                |
| `apps/web/src/components/CommandPalette.tsx`                | names the project-less entries Chats and New chat                                                      |
| `apps/web/src/components/T3Wordmark.tsx`                    | renders the Ozone mark wherever upstream shows its wordmark                                            |
| `apps/web/src/components/chat/ChatHeader.tsx`               | a chat's breadcrumb says Chats                                                                         |
| `apps/web/src/components/chat/DraftHeroHeadline.tsx`        | a new chat's project picker says Chats                                                                 |
| `apps/web/src/components/chat/useComposerSend.ts`           | sending a prompt no longer counts towards upstream's star prompt                                       |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`         | sidebar brand name                                                                                     |
| `apps/web/src/routes/_chat.index.tsx`                       | the index route shows Ozone's home                                                                     |
| `apps/web/vite.config.ts`                                   | `OZONE_TEST_CHROMIUM` names the browser for tests where Playwright's own build is missing              |
| `knip.jsonc`                                                | finds the scripts upstream's parked workflows still name                                               |
| `packages/client-runtime/src/rpc/client.ts`                 | lists Ozone's streaming RPC methods beside upstream's                                                  |
| `packages/client-runtime/src/state/projectGrouping.test.ts` | expects the Chats label                                                                                |
| `packages/client-runtime/src/state/projectGrouping.ts`      | the group of project-less threads is labelled Chats                                                    |
| `packages/contracts/src/index.ts`                           | exports Ozone's contracts                                                                              |
| `packages/contracts/src/rpc.ts`                             | adds Ozone's RPC methods to the WebSocket group                                                        |
| `packages/shared/src/cliRelease.ts`                         | release archives come from Ozone's repository                                                          |
| `scripts/notify-discord-release.test.ts`                    | reads upstream's release workflow from its parked location                                             |
| `vite.config.ts`                                            | keeps formatter, linter and test runner out of template sources                                        |

## Untagged

These files cannot carry a comment, or were moved or replaced rather than edited.

| File                                   | Why                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                            | also imports `docs/ozone/AGENTS.md`                                                             |
| `README.md`                            | replaced with Ozone's; upstream's is in its own repository                                      |
| `.github/workflows-upstream/`          | upstream's workflows, moved out of `.github/workflows/` so GitHub does not run them             |
| `apps/server/package.json`             | adds the `ozone` bin beside `t3`                                                                |
| `apps/web/public/manifest.webmanifest` | product name                                                                                    |
| `assets/`                              | icon files replaced in place with the Ozone icon set (the `.icon` sources are still upstream's) |
| `apps/web/public/`                     | the web copies of those icons                                                                   |
| `packages/client-runtime/package.json` | exports `./state/ozone`                                                                         |
