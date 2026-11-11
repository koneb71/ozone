import type { OzoneBuild, OzoneBuildSnapshot, OzoneBuildTask } from "@t3tools/contracts";

export interface BuildHeadline {
  readonly tone: "info" | "success" | "warning";
  readonly title: string;
  readonly detail: string | undefined;
  readonly busy: boolean;
}

const settled = (task: OzoneBuildTask) => task.status === "done" || task.status === "skipped";

/** What a task is doing, in the words the build card shows beside its title. */
export function taskStateLabel(task: OzoneBuildTask, build: OzoneBuild): string {
  switch (task.status) {
    case "pending":
      return task.attempts > 0 ? "Going back for repair" : "Waiting";
    case "running":
      return task.attempts > 1 ? `Repairing (${task.attempts}/${build.maxAttempts})` : "Working";
    case "checking":
      return "Checking";
    case "blocked":
      return "Needs a decision";
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
  }
}

/** The one line that says where a build stands. Null when there is nothing to show yet. */
export function buildHeadline(snapshot: OzoneBuildSnapshot | null): BuildHeadline | null {
  const build = snapshot?.build ?? null;
  if (snapshot === null || build === null || build.tasks.length === 0) return null;
  const done = build.tasks.filter(settled).length;
  const progress = `${done} of ${build.tasks.length} tasks done`;
  if (snapshot.status === "complete") {
    return { tone: "success", title: "Build complete", detail: progress, busy: false };
  }
  const blocked = build.tasks.find((task) => task.status === "blocked");
  if (blocked !== undefined) {
    return {
      tone: "warning",
      title: "The build needs a decision",
      detail: `${blocked.title}: ${blocked.blockedReason ?? "it could not be finished."}`,
      busy: false,
    };
  }
  if (snapshot.status === "blocked") {
    return {
      tone: "warning",
      title: "The final check failed",
      detail: build.finalEvidence
        .filter((gate) => !gate.ok)
        .map((gate) => gate.id)
        .join(", "),
      busy: false,
    };
  }
  const active = build.tasks.find(
    (task) => task.status === "running" || task.status === "checking",
  );
  return {
    tone: "info",
    title: `Building · ${progress}`,
    detail: active === undefined ? undefined : `${taskStateLabel(active, build)}: ${active.title}`,
    busy: active !== undefined,
  };
}
