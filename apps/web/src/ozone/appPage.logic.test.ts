import { describe, expect, it } from "vite-plus/test";

import {
  appActionsFor,
  APP_SECTION_GROUPS,
  APP_SECTIONS,
  appSectionOf,
  autoDeployLocked,
  deploymentTone,
  metaLine,
  needsDeploy,
  phaseTone,
  productionSnapshots,
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

  it("keeps what a deleted deployment left behind within reach", () => {
    // Its history and its deleted places stay readable. Only live metrics need a deployment.
    expect(needsDeploy("deployments")).toBe(false);
    expect(needsDeploy("monitoring")).toBe(true);
    // The snapshot taken before the delete is the only copy of that data.
    expect(productionSnapshots({ deployed: false, count: 1 })).toEqual({
      show: true,
      canChange: false,
    });
    expect(productionSnapshots({ deployed: false, count: 0 }).show).toBe(false);
    expect(productionSnapshots({ deployed: false, count: null }).show).toBe(false);
    expect(productionSnapshots({ deployed: true, count: 0 })).toEqual({
      show: true,
      canChange: true,
    });
    // A switch left on can always be turned off.
    expect(autoDeployLocked({ deployed: false, on: true })).toBe(false);
    expect(autoDeployLocked({ deployed: false, on: false })).toBe(true);
    expect(autoDeployLocked({ deployed: true, on: false })).toBe(false);
  });
});

describe("appActionsFor", () => {
  const all = { restart: true, rebuild: true, stop: true, delete: true };
  const none = { restart: false, rebuild: false, stop: false };

  it.each([
    ["running", false, all],
    ["unhealthy", false, all],
    // Containers of a failed app can still be up, so it can be stopped.
    ["failed", false, { ...all, restart: false }],
    ["stopped", false, { ...all, restart: false, stop: false }],
    ["starting", false, { ...none, delete: true }],
    ["running", true, { ...none, delete: true }],
    // Without Docker nothing can run, and a delete could not save the data first.
    ["unavailable", false, { ...none, delete: false }],
    [undefined, false, { ...all, restart: false, stop: false }],
  ] as const)("%s, acting %s", (phase, acting, offered) => {
    expect(appActionsFor({ phase, acting })).toEqual(offered);
  });
});
