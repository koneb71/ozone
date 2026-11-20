import { expect, it } from "vite-plus/test";

import { cutChangelog, lastReleased, nextVersion } from "./cut-release.ts";
import { releaseNotes } from "./release-notes.ts";

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "### Fixed",
  "",
  "- A page that could not load says why.",
  "",
  "## 1.10.0 - 2026-11-20",
  "",
  "### Added",
  "",
  "- Delete deployment.",
  "",
].join("\n");

it("files what was unreleased under the version, and opens an empty section above it", () => {
  const cut = cutChangelog(changelog, "1.10.1", "2026-11-21");
  if ("problem" in cut) throw new Error(cut.problem);
  expect(cut.changelog.split("\n").slice(2, 6)).toEqual([
    "## Unreleased",
    "",
    "## 1.10.1 - 2026-11-21",
    "",
  ]);
  // The release workflow drafts its notes from exactly this section.
  expect(releaseNotes(cut.changelog, "1.10.1")).toBe(
    "### Fixed\n\n- A page that could not load says why.",
  );
  expect(releaseNotes(cut.changelog, "Unreleased")).toBeNull();
  expect(releaseNotes(cut.changelog, "1.10.0")).toBe("### Added\n\n- Delete deployment.");
});

it("refuses when there is nothing to release, or the version is already there", () => {
  const cut = cutChangelog(changelog, "1.10.1", "2026-11-21");
  if ("problem" in cut) throw new Error(cut.problem);
  // Cutting twice in a row finds the new Unreleased empty.
  expect(cutChangelog(cut.changelog, "1.10.2", "2026-11-22")).toHaveProperty("problem");
  expect(cutChangelog(changelog, "1.10.0", "2026-11-21")).toHaveProperty("problem");
  expect(cutChangelog("# Changelog\n", "1.0.0", "2026-11-21")).toHaveProperty("problem");
});

it("names the next version from the last one released", () => {
  expect(lastReleased(changelog)).toBe("1.10.0");
  expect(nextVersion("1.10.0", "patch")).toBe("1.10.1");
  expect(nextVersion("1.10.0", "minor")).toBe("1.11.0");
  expect(nextVersion("1.10.0", "major")).toBe("2.0.0");
  expect(nextVersion("1.10.0", "1.12.0-rc.1")).toBe("1.12.0-rc.1");
  // Two numbers is not a version the release workflow accepts.
  expect(nextVersion("1.10.0", "1.11")).toBeNull();
  expect(nextVersion(null, "patch")).toBeNull();
});
