# Brand icons

These PNG and ICO files are the icons the builds use. There is one set per build flavor:

- `dev/` for development builds. `apps/web/public` holds copies of its web icons.
- `prod/` for released builds.
- `nightly/` for a build whose version ends in `-nightly.<date>.<n>`.

In each set:

| File                                                                            | Used for                           |
| ------------------------------------------------------------------------------- | ---------------------------------- |
| `*-macos-1024.png`                                                              | the macOS app icon                 |
| `*-universal-1024.png`                                                          | the Linux app icon                 |
| `*-windows.ico`                                                                 | the Windows app and installer icon |
| `*-web-favicon.ico`, `*-web-favicon-16x16.png`, `*-web-favicon-32x32.png`       | the browser favicon                |
| `*-web-apple-touch-180.png`, `*-web-icon-192x192.png`, `*-web-icon-512x512.png` | the web app manifest               |

The paths are listed in [`scripts/lib/brand-assets.ts`](../scripts/lib/brand-assets.ts), which
`scripts/build-desktop-artifact.ts` and `scripts/apply-web-brand-assets.ts` read. Keep the file
names when replacing an icon.

`prod/logo.svg` is the Ozone mark as a vector.

The macOS PNG must be 1024×1024 with the classic macOS safe area: the opaque icon body is 824×824,
inset 100 pixels on every side, with only a shadow extending into the transparent canvas.
