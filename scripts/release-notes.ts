// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- The release workflow's draft job runs this with no dependencies installed.
// Prints one version's section of CHANGELOG.md: `node scripts/release-notes.ts 1.9.0`.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BLOCK_START = /^(?:[-*+] |\d+\. |#|>|\||```)/;

// GitHub shows each newline in release notes as a line break, so a wrapped line joins the one above.
const unwrap = (lines: ReadonlyArray<string>) => {
  const joined: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const text = line.trim();
    const previous = joined.at(-1);
    if (text.startsWith("```")) inFence = !inFence;
    const continues =
      !inFence &&
      text !== "" &&
      !BLOCK_START.test(text) &&
      previous !== undefined &&
      previous.trim() !== "" &&
      !previous.trimStart().startsWith("#");
    if (continues) joined[joined.length - 1] = `${previous} ${text}`;
    else joined.push(line);
  }
  return joined;
};

/** The text under `## <version>`, up to the next `## ` heading, or null when there is none. */
export function releaseNotes(changelog: string, version: string): string | null {
  const heading = new RegExp(`^## ${escapeRegExp(version)}(?: |$)`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const notes = unwrap(end === -1 ? rest : rest.slice(0, end))
    .join("\n")
    .trim();
  return notes === "" ? null : notes;
}

if (import.meta.main) {
  const version = process.argv[2]?.replace(/^v/, "");
  if (version === undefined || version === "") {
    console.error("Usage: node scripts/release-notes.ts <version>");
    process.exit(2);
  }
  const changelog = NodeFS.readFileSync(
    NodePath.join(import.meta.dirname, "..", "CHANGELOG.md"),
    "utf8",
  );
  const notes = releaseNotes(changelog, version);
  if (notes === null) {
    console.error(`CHANGELOG.md has no entries under "## ${version}".`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
