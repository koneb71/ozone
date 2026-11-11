/**
 * The text a build sends to agents: each worker's brief, the `next` line of every report, and
 * what a lead reads when the server wakes it. Model-facing, with no eval cases yet: after a
 * change, run a real build and read what agents do.
 */
import {
  OZONE_VERIFICATION_ID,
  type OzoneBuild,
  type OzoneBuildTask,
  type OzoneBuildVerification,
  type OzoneCriterionResult,
  type OzoneGateResult,
  type ThreadId,
} from "@t3tools/contracts";

import type { WakeNote } from "./BuildWake.ts";

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
            : failures.map((gate) => `${gate.id}: ${gate.detail}`),
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
  review:
    "The plan is saved, and nothing is built until the user approves it. Tell the user in a few sentences what you plan to build, and that they start it from the plan shown above the message box. Then end your turn; you are woken when they approve. If they ask for changes, call ozone_build_plan again. If they tell you in the chat to go ahead, call ozone_build_advance with `approved: true`.",
  advance: "Call ozone_build_advance.",
  complete: (url: string, verification: OzoneBuildVerification) =>
    [
      `The build is complete and the app is running at ${url}.`,
      ...(verification.status === "passed"
        ? ["A tester used the app in a browser, and what it tried works."]
        : verification.status === "unavailable"
          ? [
              `No tester could try the app in a browser${verification.note === null ? "" : ` (${verification.note})`}, so only the project's own checks vouch for it. Say so.`,
            ]
          : []),
      "Tell the user what was built and where to try it, with the full address of each new page. Do not call ozone_build_advance again.",
    ].join(" "),
  working: (task: OzoneBuildTask) =>
    `A worker is still on task ${task.id}. End your turn now. You are woken when it finishes; then call ozone_build_advance again.`,
  checking: (task: OzoneBuildTask) =>
    `Ozone is checking task ${task.id}. End your turn now. You are woken when the checks finish; then call ozone_build_advance again.`,
  finalChecking:
    "Every task passed and the final check is running. End your turn now. You are woken when it finishes; then call ozone_build_advance again.",
  verifying:
    "A tester is using the app in a browser. End your turn now. You are woken when it finishes; then call ozone_build_advance again.",
  needsAnswer: (who: string, workerThreadId: ThreadId | null) =>
    `${who} is waiting for an answer in its thread${workerThreadId === null ? "" : ` ${workerThreadId}`}. Answer it with t3_pending_request if you can, or ask the user, then call ozone_build_advance again.`,
  blocked: (task: OzoneBuildTask) =>
    `Task ${task.id} is blocked: ${task.blockedReason ?? "it needs a decision."} Rule on it with ozone_build_resolve: retry (with a note on what to do differently), skip, or accept. Ask the user first only if the choice changes what they get.`,
  finalFailed: (failed: ReadonlyArray<OzoneGateResult>) =>
    [
      `Every task passed, but the final check failed (${failed.map((gate) => gate.id).join(", ")}).`,
      ...failed.map((gate) => `${gate.id}: ${gate.detail}`),
      "The build is not done. Add a task that fixes it with ozone_build_plan, keeping the finished tasks, then call ozone_build_advance.",
    ].join("\n"),
  verifyFailed: (results: ReadonlyArray<OzoneCriterionResult>) =>
    [
      "Every check passed, but a tester used the app in a browser and it does not do what was asked:",
      ...results
        .filter((result) => result.verdict === "fail")
        .map((result) => `- ${result.criterion}: ${result.note}`),
      `The build is not done. Add a task that fixes it with ozone_build_plan, keeping the finished tasks, then call ozone_build_advance. If the tester is wrong, call ozone_build_resolve with taskId \`${OZONE_VERIFICATION_ID}\`: \`retry\` has the app tried again, \`accept\` keeps the build and needs a note saying why.`,
    ].join("\n"),
  checksPass: "Every check passes.",
  finalPasses:
    "Every check passes, the final one too. Call ozone_build_advance to finish the build.",
  waitingOnPlan:
    "Nothing can start: the remaining tasks wait on tasks that are not in the plan as done. Revise the plan with ozone_build_plan.",
} as const;

const AFTER_A_WAKE = "Call ozone_build_advance to see the result and take the next step.";

/** What the server says when it brings a lead back. The report of the next call says the rest. */
export const WAKE = {
  taskChecked: (task: OzoneBuildTask, passed: boolean): WakeNote => ({
    summary: `${passed ? "Checks passed" : "Checks failed"}: ${task.title}`,
    text: `Ozone has checked task ${task.id}. ${AFTER_A_WAKE}`,
    outcome: passed ? "completed" : "failed",
  }),
  finalChecked: (passed: boolean): WakeNote => ({
    summary: passed ? "The final check passed" : "The final check failed",
    text: `Ozone has run the final check. ${AFTER_A_WAKE}`,
    outcome: passed ? "completed" : "failed",
  }),
  checkBroke: (message: string): WakeNote => ({
    summary: "The checks could not run",
    text: `Ozone could not run its checks: ${message} Call ozone_build_advance to run them again, and tell the user if that fails too.`,
    outcome: "failed",
  }),
  approved: {
    summary: "Plan approved",
    text: "The user approved the plan. Call ozone_build_advance to start building.",
    outcome: "completed",
  } satisfies WakeNote,
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
