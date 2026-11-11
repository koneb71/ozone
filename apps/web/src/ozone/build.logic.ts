import type {
  OzoneBuild,
  OzoneBuildSnapshot,
  OzoneBuildTask,
  OzoneCriterionResult,
} from "@t3tools/contracts";

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

export const CRITERION_LABEL: Record<OzoneCriterionResult["verdict"], string> = {
  pass: "Works",
  fail: "Does not work",
  unchecked: "Not tried",
};

const failedCriteria = (build: OzoneBuild) =>
  build.verification.results.filter((result) => result.verdict === "fail");

/** The one line that says where a build stands. Null when there is nothing to show yet. */
export function buildHeadline(snapshot: OzoneBuildSnapshot | null): BuildHeadline | null {
  const build = snapshot?.build ?? null;
  if (snapshot === null || build === null || build.tasks.length === 0) return null;
  const done = build.tasks.filter(settled).length;
  const progress = `${done} of ${build.tasks.length} tasks done`;
  const tasks = `${build.tasks.length} ${build.tasks.length === 1 ? "task" : "tasks"}`;
  if (snapshot.status === "review") {
    return {
      tone: "info",
      title: "The plan is ready for you",
      detail: `${tasks}. Start it here, or ask for changes below.`,
      busy: false,
    };
  }
  if (snapshot.status === "complete") {
    const tried =
      build.verification.status === "passed"
        ? " · Tried in a browser"
        : build.verification.status === "accepted"
          ? " · Kept despite the browser test"
          : "";
    return { tone: "success", title: "Build complete", detail: `${progress}${tried}`, busy: false };
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
    const failedGates = build.finalEvidence.filter((gate) => !gate.ok);
    if (failedGates.length > 0) {
      return {
        tone: "warning",
        title: "The final check failed",
        detail: failedGates.map((gate) => gate.id).join(", "),
        busy: false,
      };
    }
    const failed = failedCriteria(build);
    return {
      tone: "warning",
      title: "The app does not do everything asked",
      detail: `A browser test found ${failed.length === 1 ? "1 problem" : `${failed.length} problems`}. The lead is on it.`,
      busy: false,
    };
  }
  const active = build.tasks.find(
    (task) => task.status === "running" || task.status === "checking",
  );
  if (active !== undefined) {
    return {
      tone: "info",
      title: `Building · ${progress}`,
      detail: `${taskStateLabel(active, build)}: ${active.title}`,
      busy: true,
    };
  }
  if (build.finalStartedAt !== null) {
    return { tone: "info", title: "Running the final check", detail: progress, busy: true };
  }
  const testing = build.verification.status;
  if (testing === "running" || testing === "pending") {
    return {
      tone: "info",
      title: "Trying the app in a browser",
      detail: "A tester uses it the way you would.",
      busy: true,
    };
  }
  return { tone: "info", title: `Building · ${progress}`, detail: undefined, busy: false };
}
