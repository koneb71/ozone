import { describe, expect, it } from "vite-plus/test";

import {
  cliArchivePlatformKey,
  cliArchiveTarCommand,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  ozone-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *ozone-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("ozone-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("ozone-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  // A key with no archive behind it passes the host check and then fails at the download.
  it.each([
    ["darwin", "arm64", "darwin-arm64"],
    ["linux", "x64", "linux-x64"],
    ["win32", "x64", "win32-x64"],
    ["linux", "arm64", undefined],
    ["win32", "arm64", undefined],
    ["darwin", "x64", undefined],
  ] as const)("names the archive a release has for %s %s", (platform, arch, key) => {
    expect(cliArchivePlatformKey(platform, arch)).toBe(key);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest release that is not a draft", () => {
    const releases = [
      { tag_name: "v1.2.4", draft: true },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.2" },
    ];
    expect(newestCliReleaseVersion(releases)).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.4", draft: true }])).toBeUndefined();
  });
});
