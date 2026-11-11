# Seams

Every upstream file Ozone edits. `apps/server/src/ozone/seams.test.ts` checks this list against the
`ozone-seam` tags in the repository, in both directions. Keep the reason to one line.

## Tagged

These files contain a comment with `ozone-seam` at each edit.

| File                                                | Why                                                           |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `apps/server/src/cli/app.test.ts`                   | expects Ozone's default data directory name                   |
| `apps/server/src/cli/browser.ts`                    | browser setup under sudo uses the Ozone data directory        |
| `apps/server/src/cli/config.test.ts`                | expects Ozone's default port                                  |
| `apps/server/src/cloud/npmRelease.ts`               | keeps upstream's unused release layer exported                |
| `apps/server/src/config.ts`                         | default port 3737                                             |
| `apps/server/src/os-jank.ts`                        | default data directory `~/.ozone`                             |
| `apps/server/src/telemetry/AnalyticsService.ts`     | telemetry off, with no upstream key or host                   |
| `apps/server/src/ws.ts`                             | provides Ozone's release lookup instead of upstream's npm one |
| `apps/web/index.html`                               | product name on the splash screen                             |
| `apps/web/src/branding.ts`                          | product name                                                  |
| `apps/web/src/components/GitHubStarPrompt.tsx`      | upstream's star prompt is off                                 |
| `apps/web/src/components/T3Wordmark.tsx`            | renders the Ozone mark wherever upstream shows its wordmark   |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | sidebar brand name                                            |
| `knip.jsonc`                                        | finds the scripts upstream's parked workflows still name      |
| `packages/shared/src/cliRelease.ts`                 | release archives come from Ozone's repository                 |
| `scripts/notify-discord-release.test.ts`            | reads upstream's release workflow from its parked location    |

## Untagged

These files cannot carry a comment, or were moved or replaced rather than edited.

| File                                   | Why                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                            | also imports `docs/ozone/AGENTS.md`                                                             |
| `.github/workflows-upstream/`          | upstream's workflows, moved out of `.github/workflows/` so GitHub does not run them             |
| `apps/server/package.json`             | adds the `ozone` bin beside `t3`                                                                |
| `apps/web/public/manifest.webmanifest` | product name                                                                                    |
| `assets/`                              | icon files replaced in place with the Ozone icon set (the `.icon` sources are still upstream's) |
| `apps/web/public/`                     | the web copies of those icons                                                                   |
