import { describe, expect, it } from "vite-plus/test";

import {
  APP_SECTION_GROUPS,
  APP_SECTIONS,
  appSectionOf,
  deploymentTone,
  metaLine,
  phaseTone,
} from "./appPage.logic";

describe("app page sections", () => {
  it("lists every section once in the navigation, and falls back to the overview", () => {
    expect(APP_SECTION_GROUPS.flatMap((group) => group.sections).toSorted()).toEqual(
      [...APP_SECTIONS].toSorted(),
    );
    expect(appSectionOf("deployments")).toBe("deployments");
    expect(appSectionOf("settings")).toBe("overview");
    expect(appSectionOf(undefined)).toBe("overview");
  });

  it("reads containers and deploys as status dots", () => {
    expect(phaseTone("running")).toEqual({ tone: "success", busy: false });
    expect(phaseTone("starting")).toEqual({ tone: "warning", busy: true });
    expect(phaseTone("failed").tone).toBe("error");
    expect(phaseTone(undefined).tone).toBe("idle");
    expect(deploymentTone("running")).toEqual({ tone: "warning", busy: true });
    expect(deploymentTone("failed").tone).toBe("error");
  });

  it("joins only the parts of a line that are known", () => {
    expect(metaLine(["2m ago", null, "", false, "abc1234"])).toBe("2m ago · abc1234");
  });
});
