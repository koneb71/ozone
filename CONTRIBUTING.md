# Contributing

Ozone is developed at [koneb71/ozone](https://github.com/koneb71/ozone).

## Issues

Report a bug with the [bug report form](https://github.com/koneb71/ozone/issues/new/choose). Search
the open issues first, and keep each report to one problem. Report a security problem privately, as
the [security policy](.github/SECURITY.md) describes.

## Pull requests

<a id="one-problem"></a>

- **One problem per pull request.** Include every change that problem needs across contracts,
  server, clients, tests and docs. Cleanup, refactors and a second fix go in their own pull
  requests.
- **Run the checks before you push.** `vp run check:changed` runs CI's fast checks for the files
  you changed.
- **Show that it works.** Say how you checked the change and what you saw. UI changes need before
  and after screenshots, uploaded to the pull request and not committed.
- **Follow the conventions in [AGENTS.md](AGENTS.md).** It covers how the code is laid out, how to
  test, and what belongs in the docs. It applies to people and to coding agents alike.

## Setup

See the [development runbook](docs/operations/development.md#first-checkout).
