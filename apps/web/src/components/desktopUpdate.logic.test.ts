import { describe, expect, it } from "vite-plus/test";
import type { DesktopUpdateState } from "@t3tools/contracts";

import {
  canCheckForUpdate,
  desktopUpdateToAnnounce,
  getDesktopUpdateButtonLabel,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
  resolveDesktopUpdateButtonAction,
} from "./desktopUpdate.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("desktop update button state", () => {
  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("shows the download failure after returning to available", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toBe("Download failed for 1.1.0. Click to retry.");
    expect(getDesktopUpdateButtonTooltip({ ...state, notAppliedVersion: "1.1.0" })).toBe(
      "Update 1.1.0 did not apply. Click to retry.",
    );
  });

  it("prefers a newly available release over a stale downloaded version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
      downloadedVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("hides the install action while checking for a newer release", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "checking",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });
});

describe("desktop update UI helpers", () => {
  it.each(["owner/repo/extra", "owner#notes/repo", "owner/repo?tab=notes"])(
    "falls back to the Ozone repository for an invalid configured repository: %s",
    (repository) => {
      expect(getDesktopUpdateReleaseHistoryUrl(repository)).toBe(
        "https://github.com/koneb71/ozone/releases",
      );
      expect(getDesktopUpdateReleaseUrl("1.2.3", repository)).toBe(
        "https://github.com/koneb71/ozone/releases/tag/v1.2.3",
      );
    },
  );
});

describe("canCheckForUpdate", () => {
  it("returns true once an update has been downloaded so newer releases can be found", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(true);
  });
});

describe("the update control's words", () => {
  it.each([
    [{ status: "idle" }, null],
    [{ status: "up-to-date" }, null],
    [{ status: "available", availableVersion: "1.2.0" }, "Update to 1.2.0"],
    [
      { status: "downloading", availableVersion: "1.2.0", downloadPercent: 40.7 },
      "Downloading 40%",
    ],
    [{ status: "downloaded", downloadedVersion: "1.2.0" }, "Restart to update"],
    [{ status: "error", errorContext: "download", availableVersion: "1.2.0" }, "Update to 1.2.0"],
  ] as const)("%j", (extra, label) => {
    expect(getDesktopUpdateButtonLabel({ ...baseState, ...extra })).toBe(label);
  });

  it("announces a version once, and never one that failed to apply", () => {
    const available: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
    };
    expect(desktopUpdateToAnnounce(available, null)).toBe("1.2.0");
    expect(desktopUpdateToAnnounce(available, "1.1.0")).toBe("1.2.0");
    expect(desktopUpdateToAnnounce(available, "1.2.0")).toBeNull();
    expect(desktopUpdateToAnnounce({ ...available, notAppliedVersion: "1.2.0" }, null)).toBeNull();
    expect(desktopUpdateToAnnounce({ ...available, status: "downloading" }, null)).toBeNull();
    expect(desktopUpdateToAnnounce(null, null)).toBeNull();
  });
});
