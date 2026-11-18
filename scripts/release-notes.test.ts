import { expect, it } from "vite-plus/test";

import { releaseNotes } from "./release-notes.ts";

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "## 1.0.10 - 2026-11-20",
  "",
  "### Fixed",
  "",
  "- Ten.",
  "",
  "## 1.0.1 - 2026-11-13",
  "",
  "### Added",
  "",
  "- One that",
  "  wraps.",
  "  - A nested one.",
  "",
  "### Fixed",
  "",
  "- Also one.",
  "",
  "```sh",
  "ozone up",
  "--help",
  "```",
  "",
  "## 1.0.0 - 2026-11-13",
  "",
  "The first",
  "release.",
  "",
].join("\n");

it("takes a version's section with its subheadings, and no other version's", () => {
  expect(releaseNotes(changelog, "1.0.1")).toBe(
    "### Added\n\n- One that wraps.\n  - A nested one.\n\n### Fixed\n\n- Also one.\n\n```sh\nozone up\n--help\n```",
  );
  expect(releaseNotes(changelog, "1.0.10")).toBe("### Fixed\n\n- Ten.");
  expect(releaseNotes(changelog, "1.0.0")).toBe("The first release.");
  expect(releaseNotes(changelog.replaceAll("\n", "\r\n"), "1.0.0")).toBe("The first release.");
});

it("has nothing for a version without entries", () => {
  expect(releaseNotes(changelog, "1.0")).toBeNull();
  expect(releaseNotes(changelog, "2.0.0")).toBeNull();
  expect(releaseNotes(changelog, "Unreleased")).toBeNull();
});
