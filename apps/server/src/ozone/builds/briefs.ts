/**
 * The text a build sends to agents: each worker's brief, and the `next` line of every report.
 * Model-facing, with no eval cases yet: after a change, run a real build and read what agents do.
 */
import type { OzoneBuild, OzoneBuildTask } from "@t3tools/contracts";

const DETAIL_CHARS = 1_200;

const bullets = (lines: ReadonlyArray<string>) => lines.map((line) => `- ${line}`).join("\n");

/** Everything a worker is told. It starts with `Ozone task`, which the app's AGENTS.md keys on. */
export const workerBrief = (
  build: OzoneBuild,
  task: OzoneBuildTask,
  checks: ReadonlyArray<string>,
): string => {
  const position = build.tasks.findIndex((candidate) => candidate.id === task.id) + 1;
  const sections = [`Ozone task ${position} of ${build.tasks.length}: ${task.title}`, task.brief];
  if (task.acceptance.length > 0) {
    sections.push(`It is done when:\n${bullets(task.acceptance)}`);
  }
  const failures = task.evidence.filter((gate) => !gate.ok);
  // After a retry ruling the count starts over, but what went wrong still has to be said.
  if (task.attempts > 0 || failures.length > 0) {
    sections.push(
      [
        task.attempts > 0
          ? `This is attempt ${task.attempts + 1} of ${build.maxAttempts}. The last attempt did not pass:`
          : "Earlier attempts at this task did not pass:",
        bullets(
          failures.length === 0
            ? ["Its worker stopped before finishing."]
            : failures.map((gate) => `${gate.id}: ${gate.detail.slice(-DETAIL_CHARS)}`),
        ),
        ...(task.summary === null ? [] : [`The last worker reported: ${task.summary}`]),
        "Its changes are still in the working tree. Fix the cause, not the check.",
      ].join("\n"),
    );
  }
  sections.push(
    [
      "How to work:",
      bullets([
        "The spec is in .ozone/spec.md and the whole plan in .ozone/plan.md. Read them only if you need the wider picture.",
        "Run every command through ./dev, for example `./dev npm run typecheck`.",
        task.access === "read"
          ? "This task is read-only. Change no files."
          : `Do not commit, and do not start, stop or rebuild the app. Ozone runs the checks itself (${checks.join(", ")}) and commits your work when they pass.`,
        "Finish with what you changed, what the next task must know, and anything you could not finish.",
      ]),
    ].join("\n"),
  );
  return sections.join("\n\n");
};

export const NEXT = {
  plan: "There is no plan yet. Call ozone_build_plan with the spec, the acceptance criteria and the tasks.",
  planned: "The plan is saved. Call ozone_build_advance to start the first task.",
  advance: "Call ozone_build_advance.",
  complete: (url: string) =>
    `The build is complete and the app is running at ${url}. Tell the user what was built and where to try it, with the full address of each new page. Do not call ozone_build_advance again.`,
  working: (task: OzoneBuildTask) =>
    `A worker is still on task ${task.id}. End your turn now. You are woken when it finishes; then call ozone_build_advance again.`,
  needsAnswer: (task: OzoneBuildTask) =>
    `The worker on task ${task.id} is waiting for an answer in its thread${task.workerThreadId === null ? "" : ` ${task.workerThreadId}`}. Answer it with t3_pending_request if you can, or ask the user, then call ozone_build_advance again.`,
  blocked: (task: OzoneBuildTask) =>
    `Task ${task.id} is blocked: ${task.blockedReason ?? "it needs a decision."} Rule on it with ozone_build_resolve: retry (with a note on what to do differently), skip, or accept. Ask the user first only if the choice changes what they get.`,
  finalFailed: (checks: ReadonlyArray<string>) =>
    `Every task passed, but the final check failed (${checks.join(", ")}). Add a task that fixes it with ozone_build_plan, keeping the finished tasks, then call ozone_build_advance.`,
  waitingOnPlan:
    "Nothing can start: the remaining tasks wait on tasks that are not in the plan as done. Revise the plan with ozone_build_plan.",
} as const;

/** The spec as a file in the app, so briefs point at it instead of repeating it. */
export const specFile = (build: OzoneBuild): string =>
  ["# Spec", "", build.spec, "", "## Done when", "", bullets(build.acceptance), ""].join("\n");

export const planFile = (build: OzoneBuild): string =>
  [
    "# Plan",
    "",
    "Ozone hands these tasks to workers in order and checks each one. Edit the plan through the lead, not here.",
    "",
    ...build.tasks.flatMap((task, index) => [
      `## ${index + 1}. ${task.title} (\`${task.id}\`)`,
      "",
      ...(task.dependsOn.length === 0 ? [] : [`After: ${task.dependsOn.join(", ")}`, ""]),
      task.brief,
      "",
      ...(task.acceptance.length === 0 ? [] : [bullets(task.acceptance), ""]),
    ]),
  ].join("\n");
