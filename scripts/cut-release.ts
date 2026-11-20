// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- A release chore a person runs by hand, with no services to build.
// Cuts the next release's section of CHANGELOG.md: `vp run release:cut 1.11.0`, or `patch`, `minor` or `major`.
// It stages the file and prints what to run next. It never commits, pushes or tags.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { releaseNotes } from "./release-notes.ts";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const UNRELEASED = "## Unreleased";

/** The newest released version the changelog lists, or null when it lists none. */
export function lastReleased(changelog: string): string | null {
  for (const line of changelog.split(/\r?\n/)) {
    const match = /^## (\d+\.\d+\.\d+\S*)/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** The version to cut: the one named, or the last release with one part raised. */
export function nextVersion(last: string | null, wanted: string): string | null {
  if (VERSION.test(wanted)) return wanted;
  const parts = last === null ? null : /^(\d+)\.(\d+)\.(\d+)/.exec(last);
  if (parts === null) return null;
  const [major, minor, patch] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  switch (wanted) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return null;
  }
}

/**
 * The changelog with what was unreleased filed under the version, and a new, empty
 * `## Unreleased` above it. A problem instead, when there is nothing to cut.
 */
export function cutChangelog(
  changelog: string,
  version: string,
  date: string,
): { readonly changelog: string } | { readonly problem: string } {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === UNRELEASED);
  if (start === -1) return { problem: `CHANGELOG.md has no "${UNRELEASED}" heading.` };
  if (lines.some((line) => line === `## ${version}` || line.startsWith(`## ${version} `))) {
    return { problem: `CHANGELOG.md already has a section for ${version}.` };
  }
  if (releaseNotes(changelog, "Unreleased") === null) {
    return { problem: `Nothing is listed under "${UNRELEASED}", so there is nothing to release.` };
  }
  return {
    changelog: [
      ...lines.slice(0, start),
      UNRELEASED,
      "",
      `## ${version} - ${date}`,
      ...lines.slice(start + 1),
    ].join("\n"),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (import.meta.main) {
  const root = NodePath.join(import.meta.dirname, "..");
  const git = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

  const args = process.argv.slice(2);
  const wanted = args.find((arg) => !arg.startsWith("--"))?.replace(/^v(?=\d)/, "");
  if (wanted === undefined) {
    fail("Usage: vp run release:cut <version|patch|minor|major> [--no-ci-check]");
  }

  const file = NodePath.join(root, "CHANGELOG.md");
  const before = NodeFS.readFileSync(file, "utf8");
  const version = nextVersion(lastReleased(before), wanted);
  if (version === null) {
    fail(`"${wanted}" is not a version with three numbers, nor patch, minor or major.`);
  }

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") fail(`Releases are cut from main. This is ${branch}.`);
  if (git("status", "--porcelain") !== "") fail("Commit or stash your changes first.");
  git("fetch", "--quiet", "--tags", "origin", "main");
  if (git("rev-list", "--count", "HEAD..origin/main") !== "0") {
    fail("main is behind origin/main. Pull first.");
  }
  if (git("tag", "--list", `v${version}`) !== "") fail(`The tag v${version} already exists.`);

  if (!args.includes("--no-ci-check")) {
    const sha = git("rev-parse", "HEAD");
    const checked = NodeChildProcess.spawnSync(
      "gh",
      [
        "run",
        "list",
        "--workflow",
        "ozone-ci.yml",
        "--commit",
        sha,
        "--limit",
        "1",
        "--json",
        "status,conclusion",
      ],
      { cwd: root, encoding: "utf8" },
    );
    const run =
      checked.status === 0
        ? (JSON.parse(checked.stdout) as ReadonlyArray<{ status: string; conclusion: string }>)[0]
        : undefined;
    if (checked.status !== 0) {
      console.warn("Could not ask GitHub about CI (is gh signed in?). Check it yourself.");
    } else if (run === undefined) {
      console.warn(`CI has not run on ${sha.slice(0, 10)}. Push main and let it pass first.`);
    } else if (run.status === "completed" && run.conclusion !== "success") {
      fail(
        `CI ${run.conclusion} on ${sha.slice(0, 10)}. Fix main first, or pass --no-ci-check to cut anyway.`,
      );
    } else if (run.status !== "completed") {
      console.warn(`CI is still running on ${sha.slice(0, 10)}. The release waits for it.`);
    }
  }

  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const cut = cutChangelog(before, version, date);
  if ("problem" in cut) fail(cut.problem);
  NodeFS.writeFileSync(file, cut.changelog);
  git("add", "CHANGELOG.md");
  console.log(
    [
      `Cut ${version}. CHANGELOG.md is staged. Next:`,
      "",
      `  git commit -m 'chore(release): ${version}'`,
      "  git push origin main",
      `  git tag -a v${version} -m 'Ozone ${version}' && git push origin v${version}`,
    ].join("\n"),
  );
}
