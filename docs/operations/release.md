# Release

[ozone-release.yml](../../.github/workflows/ozone-release.yml) builds everything a person installs:
the desktop app and the command-line archive, for Linux x64, macOS arm64 and Windows x64. Each
platform builds on its own runner, so the Windows installer is built on Windows.

## Cut a release

1. Push a tag named `v<version>` with all three numbers, such as `v0.2.0`. A suffix such as
   `v0.2.0-rc.1` is accepted.
2. The workflow builds the three platforms and gathers their files into a draft GitHub Release
   titled `Ozone <version>` with generated notes.
3. Read the draft, edit the notes, and publish it. Publishing the draft is the release.

The version comes from the tag. The workflow stamps it into the package files of its own checkout
with `scripts/update-release-package-versions.ts`. Never commit that change.

## Try a build without releasing

On GitHub, open **Actions**, choose **Ozone release**, press **Run workflow** and enter a version
without the `v`. The files are attached to the finished run as `ozone-linux-x64`,
`ozone-darwin-arm64` and `ozone-win32-x64`, and are kept for 3 days. A manual run drafts no
release.

## What a build contains

| Platform    | Desktop app                            | Command-line archive                  |
| ----------- | -------------------------------------- | ------------------------------------- |
| Linux x64   | AppImage                               | `ozone-<version>-linux-x64.tar.gz`    |
| macOS arm64 | `.dmg`, and a `.zip` the updater reads | `ozone-<version>-darwin-arm64.tar.gz` |
| Windows x64 | NSIS installer (`.exe`)                | `ozone-<version>-win32-x64.zip`       |

A release also carries:

- `latest*.yml` and `*.blockmap` files. They are the update feed: an installed desktop app reads
  them from the release to find a newer version.
- `SHA256SUMS`, written by the draft job over the command-line archives. Ozone checks an archive
  against it before installing one on a remote machine or updating a background service.

An installed desktop app looks for a newer version in this repository's published releases, and a
remote machine downloads its archive from there. Both need the repository to be public. A draft is
invisible to both, so attach every file before publishing.

## What the workflow checks

- `scripts/smoke-cli-archive.ts` unpacks each command-line archive and checks the version it
  reports.
- `scripts/smoke-desktop-app.ts` opens each desktop build before the workflow keeps it: the app
  inside the mounted `.dmg`, the app after a silent run of the Windows installer, and the extracted
  AppImage under `xvfb`. On a failure, what the check saw is uploaded as `launch-check-<platform>`.

## Limits

- Nothing is signed or notarized. macOS and Windows warn before they open the app.
- The Windows app does not carry the Linux archive that running the server inside WSL needs,
  because the workflow passes no `--wsl-runtime` to `scripts/build-desktop-artifact.ts`.

To build an installer on your own machine, see
[Desktop artifacts](./development.md#desktop-artifacts).
