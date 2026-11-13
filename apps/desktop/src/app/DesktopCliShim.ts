import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Random from "effect/Random";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

// AppImage mounts change each run; the launcher must mount the image itself.
const { logInfo, logWarning } = makeComponentLogger("desktop-cli-shim");

export const MARKER = "Written by Ozone: runs the desktop app's bundled ozone CLI.";
// Ozone 1.0 wrote its launcher as `t3` with this line; T3 Code's own launcher is in its own home.
const LEGACY_MARKER = "Written by T3 Code: runs the desktop app's bundled t3 CLI.";

const SERVER_ENTRY = "apps/server/dist/bin.mjs";

const shellWord = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
/** cmd.exe expands `%` even inside quotes; Windows paths cannot contain `"`. */
const cmdText = (value: string) => value.replaceAll("%", "%%");
const cmdWord = (value: string) => `"${cmdText(value)}"`;

const MOVED = "Ozone has moved or been removed. Open the app once to update this command.";

export type CliShimTarget =
  | { readonly kind: "appimage"; readonly appImage: string; readonly executableName: string }
  | { readonly kind: "direct"; readonly executable: string; readonly entry: string }
  | { readonly kind: "windows"; readonly executable: string; readonly entry: string };

/** Embed this install's home and executable path so `sudo`, which clears the environment, uses the same install. */
export const renderCliShim = (input: {
  readonly target: CliShimTarget;
  readonly shimPath: string;
  readonly t3Home: string;
}) => {
  const { target } = input;
  if (target.kind === "windows") {
    const utf8 = [target.executable, target.entry, input.shimPath, input.t3Home].some((value) =>
      [...value].some((character) => character.codePointAt(0)! > 0x7f),
    );
    const restore = utf8 ? ["chcp %ozone_codepage% >nul"] : [];
    return [
      "@echo off",
      `rem ${MARKER}`,
      // Delayed expansion would rewrite `!name!` in paths and arguments.
      "setlocal EnableExtensions DisableDelayedExpansion",
      // Ctrl-C skips codepage restoration, so switch to UTF-8 only for non-ASCII install paths.
      ...(utf8
        ? [
            `for /f "tokens=2 delims=:." %%c in ('chcp') do set "ozone_codepage=%%c"`,
            "chcp 65001 >nul",
          ]
        : []),
      `set "T3CODE_CLI_PATH=${cmdText(input.shimPath)}"`,
      `if not defined T3CODE_HOME set "T3CODE_HOME=${cmdText(input.t3Home)}"`,
      'set "ELECTRON_RUN_AS_NODE=1"',
      // Electron's Windows executable starts without stdin; this tells the CLI to reopen the console.
      'set "T3CODE_DESKTOP_CLI_LAUNCHER=1"',
      // A goto, not a parenthesized block: "Program Files (x86)" would close the block early.
      `if exist ${cmdWord(target.executable)} goto run`,
      ...restore,
      `echo ${MOVED} 1>&2`,
      "exit /b 127",
      ":run",
      `${cmdWord(target.executable)} ${cmdWord(target.entry)} %*`,
      'set "ozone_exit=%ERRORLEVEL%"',
      ...restore,
      "exit /b %ozone_exit%",
      "",
    ].join("\r\n");
  }
  const header = [
    "#!/bin/sh",
    `# ${MARKER}`,
    `export T3CODE_CLI_PATH=${shellWord(input.shimPath)}`,
    `home=${shellWord(input.t3Home)}`,
    'export T3CODE_HOME="${T3CODE_HOME:-$home}"',
    "export ELECTRON_RUN_AS_NODE=1",
    `app=${shellWord(target.kind === "appimage" ? target.appImage : target.executable)}`,
    'if [ ! -x "$app" ]; then',
    `  echo "${MOVED}" >&2`,
    "  exit 127",
    "fi",
  ];
  if (target.kind === "direct") {
    return [...header, `exec "$app" ${shellWord(target.entry)} "$@"`, ""].join("\n");
  }
  const run = (root: string) =>
    `"${root}/${target.executableName}" "${root}/resources/app.asar/${SERVER_ENTRY}" "$@"`;
  return [
    ...header,
    // Extract-and-run would make the runtime start the app instead of mounting it.
    "unset APPIMAGE_EXTRACT_AND_RUN",
    // Its own session keeps a group signal (Ctrl-C, SSH hangup) from unmounting it under the
    // running server; the traps unmount it after. Without setsid the extract fallback runs.
    "work=$(mktemp -d) || exit 1",
    'setsid "$app" --appimage-mount >"$work/mount" 2>/dev/null &',
    "mounter=$!",
    `trap 'kill "$mounter" 2>/dev/null; rm -rf "$work"' EXIT`,
    "trap 'exit 130' INT TERM HUP",
    "mount=",
    'while kill -0 "$mounter" 2>/dev/null; do',
    '  mount=$(head -n 1 "$work/mount")',
    '  [ -d "$mount" ] && break',
    "  mount=",
    "  sleep 0.05",
    "done",
    // Without FUSE the runtime cannot mount (it prints why and exits); extracting the image still works.
    'if [ -z "$mount" ]; then',
    '  (cd "$work" && "$app" --appimage-extract >/dev/null) || { echo "Could not open $app." >&2; exit 1; }',
    '  mount="$work/squashfs-root"',
    "fi",
    run("$mount"),
    "",
  ].join("\n");
};

const userCandidates = (home: string) => [`${home}/.local/bin`, `${home}/bin`];

// Older builds also linked into these macOS folders. Such a link is found, updated in place, and
// removed, but no new link goes there.
export const commandLocations = (home: string, platform: NodeJS.Platform) => ({
  user: userCandidates(home),
  known:
    platform === "darwin"
      ? [...userCandidates(home), "/opt/homebrew/bin", "/usr/local/bin"]
      : userCandidates(home),
});

/**
 * Replaces the `t3` launcher an earlier Ozone wrote into this home, and the links that lead to it,
 * with `ozone`. A `t3` that leads anywhere else is T3 Code's and stays.
 */
export const replaceLegacyCommand = Effect.fn("desktop.cliShim.replaceLegacyCommand")(
  function* (input: {
    readonly shimPath: string;
    readonly legacyPath: string;
    readonly linkDirectories: ReadonlyArray<string>;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(input.legacyPath).pipe(Effect.option);
    if (Option.isNone(content) || !content.value.includes(LEGACY_MARKER)) return;
    for (const directory of input.linkDirectories) {
      const link = `${directory}/t3`;
      const target = yield* fs.readLink(link).pipe(Effect.option);
      if (Option.getOrUndefined(target) !== input.legacyPath) continue;
      yield* fs.symlink(input.shimPath, `${directory}/ozone`).pipe(Effect.ignore);
      yield* fs.remove(link).pipe(Effect.ignore);
    }
    yield* fs.remove(input.legacyPath).pipe(Effect.ignore);
    yield* logInfo("replaced the t3 launcher an earlier Ozone installed", {
      legacyPath: input.legacyPath,
    });
  },
);

export const launcherPath = (environment: DesktopEnvironment.DesktopEnvironment["Service"]) =>
  environment.path.join(
    environment.baseDir,
    "bin",
    environment.platform === "win32" ? "ozone.cmd" : "ozone",
  );

export const install = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (!environment.isPackaged) return Option.none<string>();
  const fs = yield* FileSystem.FileSystem;
  const path = environment.path;
  const windows = environment.platform === "win32";
  const shimPath = launcherPath(environment);
  const entry = path.join(environment.serverRoot, SERVER_ENTRY);
  const target: CliShimTarget = windows
    ? { kind: "windows", executable: process.execPath, entry }
    : Option.match(environment.appImagePath, {
        onSome: (appImage) => ({
          kind: "appimage" as const,
          appImage,
          executableName: path.basename(process.execPath),
        }),
        onNone: () => ({ kind: "direct" as const, executable: process.execPath, entry }),
      });
  const content = renderCliShim({ target, shimPath, t3Home: environment.baseDir });

  return yield* Effect.gen(function* () {
    const existing = yield* fs.readFileString(shimPath).pipe(Effect.option);
    if (Option.isSome(existing) && !existing.value.includes(MARKER)) {
      yield* logWarning("leaving an ozone launcher the app did not write", { shimPath });
      return Option.none<string>();
    }
    if (Option.getOrUndefined(existing) !== content) {
      yield* fs.makeDirectory(path.dirname(shimPath), { recursive: true });
      // Unique per call: backend startup and the first-launch command install can race here.
      const staging = `${shimPath}.${process.pid}.${yield* Random.nextIntBetween(0, 0xffffff)}.tmp`;
      yield* fs.writeFileString(staging, content, { mode: 0o755 });
      yield* fs.rename(staging, shimPath);
      yield* logInfo("installed ozone launcher", { shimPath });
    }
    yield* replaceLegacyCommand({
      shimPath,
      legacyPath: path.join(path.dirname(shimPath), windows ? "t3.cmd" : "t3"),
      linkDirectories: windows
        ? []
        : commandLocations(environment.homeDirectory, environment.platform).known,
    });
    return Option.some(shimPath);
  }).pipe(
    Effect.catchCause((cause) =>
      logWarning("could not install ozone launcher", { shimPath, cause: Cause.pretty(cause) }).pipe(
        Effect.as(Option.none<string>()),
      ),
    ),
    Effect.withSpan("desktop.cliShim.install"),
  );
});
