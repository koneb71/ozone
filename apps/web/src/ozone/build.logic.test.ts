import { ProjectId, ThreadId, type OzoneBuild, type OzoneBuildTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildHeadline, taskStateLabel } from "./build.logic";

const task = (id: string, extra: Partial<OzoneBuildTask> = {}): OzoneBuildTask => ({
  id,
  title: `Task ${id}`,
  brief: "",
  dependsOn: [],
  acceptance: [],
  access: "write",
  status: "pending",
  attempts: 0,
  dispatches: 0,
  workerTaskId: null,
  workerThreadId: null,
  baseSha: null,
  commitSha: null,
  snapshotId: null,
  evidence: [],
  summary: null,
  blockedReason: null,
  ...extra,
});
const build = (
  tasks: ReadonlyArray<OzoneBuildTask>,
  extra: Partial<OzoneBuild> = {},
): OzoneBuild => ({
  threadId: ThreadId.make("lead"),
  projectId: ProjectId.make("project"),
  spec: "",
  acceptance: [],
  tasks,
  maxAttempts: 3,
  finalEvidence: [],
  completedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("buildHeadline", () => {
  it("shows nothing before there is a plan", () => {
    expect(buildHeadline(null)).toBeNull();
    expect(buildHeadline({ build: null, status: "planning" })).toBeNull();
    expect(buildHeadline({ build: build([]), status: "planning" })).toBeNull();
  });

  it("names the task in hand and how far the build is", () => {
    const current = build([
      task("schema", { status: "done" }),
      task("page", { status: "running", attempts: 2 }),
      task("chart"),
    ]);
    expect(buildHeadline({ build: current, status: "building" })).toEqual({
      tone: "info",
      title: "Building · 1 of 3 tasks done",
      detail: "Repairing (2/3): Task page",
      busy: true,
    });
  });

  it("puts a blocked task's reason first", () => {
    const current = build([
      task("schema", { status: "blocked", blockedReason: "A new migration can lose data." }),
    ]);
    expect(buildHeadline({ build: current, status: "blocked" })).toMatchObject({
      tone: "warning",
      detail: "Task schema: A new migration can lose data.",
    });
  });

  it("tells a failed final check from a blocked task, and a finished build from both", () => {
    const allDone = [task("schema", { status: "done" }), task("extra", { status: "skipped" })];
    expect(
      buildHeadline({
        build: build(allDone, { finalEvidence: [{ id: "build", ok: false, detail: "" }] }),
        status: "blocked",
      }),
    ).toMatchObject({ title: "The final check failed", detail: "build" });
    expect(buildHeadline({ build: build(allDone), status: "complete" })).toMatchObject({
      tone: "success",
      title: "Build complete",
      detail: "2 of 2 tasks done",
    });
  });
});

describe("taskStateLabel", () => {
  it.each([
    [task("a"), "Waiting"],
    [task("a", { attempts: 1 }), "Going back for repair"],
    [task("a", { status: "running", attempts: 1 }), "Working"],
    [task("a", { status: "running", attempts: 3 }), "Repairing (3/3)"],
    [task("a", { status: "checking", attempts: 1 }), "Checking"],
    [task("a", { status: "blocked" }), "Needs a decision"],
  ])("%#", (entry, label) => {
    expect(taskStateLabel(entry, build([entry]))).toBe(label);
  });
});
