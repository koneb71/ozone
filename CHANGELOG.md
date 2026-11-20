# Changelog

What changed in each release of Ozone, newest first. Downloads are on the
[releases page](https://github.com/koneb71/ozone/releases).

## Unreleased

## 1.10.0 - 2026-11-20

### Added

- Settings, Servers lists every app Ozone deployed, including deleted apps and places an app ran
  before, with whether it still runs there. **Delete deployment** removes one from this computer or
  a server after saving a snapshot of its data here. Dokploy and hosting-platform deployments are
  listed with a link to the host.
- New web apps and landing pages get four more design skills, so Pick the design can offer looks
  from editorial calm to hard brutalist.

### Changed

- Pick the design offers three directions that each come from a different design skill and show
  your app's first screen in its real fonts, layout and 3D motion. Open one to see it large and step
  through them with the arrow keys. The motion you pick is built into the app, with a still version
  for reduced motion.

## 1.9.0 - 2026-11-19

### Added

- **Pick the design.** Turn it on from Home or an app's Build page. Before the first plan, the agent
  offers three design directions, each drawn as a small first screen in its own colours and fonts.
  Pick one, ask for others, or let the agent choose. Your pick is saved in the app's `DESIGN.md`,
  and later changes follow it.
- New web apps and landing pages come with design and SEO skills for the agents. Every page gets a
  title, a description and link-preview tags.
- A new landing page gets `robots.txt` and a sitemap. Its final check fails when a page is missing a
  title, a description, a single main heading, image descriptions or its place in the sitemap.
- Agents can look up Chrome's guidance for modern HTML and CSS. The search runs on your machine and
  sends nothing out.

### Changed

- The tester also tries a finished app with pages at phone width and in dark and light.

## 1.8.1 - 2026-11-18

### Changed

- A variable for one place, such as a live API key on a server, belongs to one app. Set it on that
  app's Deploy page.

## 1.8.0 - 2026-11-18

### Added

- Variables on a saved server, given to every app deployed there.

## 1.7.2 - 2026-11-18

### Changed

- Approving a plan turns Plan first off, so what you ask next is built straight away.

## 1.7.1 - 2026-11-17

### Fixed

- OpenCode's questions show as a card you answer in the conversation.

## 1.7.0 - 2026-11-16

### Changed

- Takes in T3 Code's improvements up to its commit `4da2bc5`.

## 1.6.1 - 2026-11-16

### Fixed

- Updates come from Ozone's own releases, and the app menus say Ozone.

### Removed

- The nightly and preview update channels.
- Importing threads from T3 Code's first version.

## 1.6.0 - 2026-11-16

### Added

- Questions and plans show as cards in the conversation. **View plan** opens the plan beside it.

## 1.5.0 - 2026-11-16

### Changed

- Plan first runs the agent in its plan mode, where it cannot change files. It asks its questions,
  then shows its plan for you to approve.

## 1.4.2 - 2026-11-16

### Fixed

- Plan first holds for every request, not only the first build.

## 1.4.1 - 2026-11-16

### Fixed

- Only you can start a plan that waits for approval. The agent cannot start it.
- Deploy stays hidden until the app has run.

## 1.4.0 - 2026-11-15

### Added

- Pick the model and the folder for a new app.

### Fixed

- Plan first works with OpenCode.

## 1.3.0 - 2026-11-14

### Changed

- **Breaking:** the environment variables you set are named `OZONE_*` instead of `T3CODE_*`. Rename
  any you use.
- The Mac app is signed and notarized by Apple.
- Deploy is on the app's page, not only in its menu.

## 1.2.1 - 2026-11-14

### Added

- Approve, revise or decline a plan the agent proposes.

## 1.2.0 - 2026-11-14

### Added

- A Plan switch above the message box.

### Changed

- Deploy and updates are easier to find, and the build card folds away.

## 1.1.0 - 2026-11-14

### Added

- Deploy to Railway, Render, Koyeb or Vercel with an account token.
- Create a GitHub repository for an app in one click from its Deploy page.
- A switch to see the plan before anything is built.
- Saved servers in Settings.

### Changed

- Ozone is the name everywhere: the command, the background service, folders on remote machines and
  the docs.

### Removed

- Analytics, and every call to an outside service you did not set up.
- T3 Connect, Clerk sign-in, the hosted relay and the mobile app.

## 1.0.1 - 2026-11-13

### Added

- Save a server once, with a pasted SSH key or a one-time password, and deploy to it.
- Deploy to a Dokploy server.
- Installers for macOS on Apple silicon, Windows and Linux.

## 1.0.0 - 2026-11-13

The first release: describe an app, and Ozone creates it from a template, runs it with Docker
Compose, builds it with coding agents and deploys it.
