/**
 * The tester: a worker that uses the finished app in a browser and says, criterion by criterion,
 * whether it does what was asked. Its brief is model-facing, with no eval cases yet: after a
 * change, run a real build and read what the tester does.
 */
import type { OzoneCriterionResult } from "@t3tools/contracts";

/** Starts with `Ozone verify`, which the app's AGENTS.md keys on. */
export const verifierBrief = (acceptance: ReadonlyArray<string>, port: number): string =>
  [
    "Ozone verify: use the app as a person would",
    "This app has passed its type check, lint, tests and production build. Find out whether it does what was asked, by using it in a browser. Only what happens in the browser counts: do not read the code to decide.",
    `The criteria:\n${acceptance.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}`,
    [
      "How to work:",
      `- Open the app with preview_open, passing \`target: {kind: "environment-port", port: ${port}}\`. It signs in with a demo account by itself. If it shows a sign-in page, press "Continue with the demo account".`,
      "- For each criterion do what a person would do: preview_snapshot shows the page, preview_act clicks and types. Then look at what the page shows.",
      "- If the app is an API with no pages, call its endpoints from the open tab with preview_evaluate, using fetch(), and read the status and the JSON it returns.",
      "- Change no files, and do not start, stop or rebuild the app.",
      "- When you are done, remove what you added where the app lets you, so the person finds it as it was.",
      "- If the browser tools do not work, do not guess. Mark every criterion UNCHECKED and say why.",
    ].join("\n"),
    [
      "End your last message with one line for each criterion, in exactly this form, and nothing after them:",
      "PASS 1",
      "FAIL 2: what you did, what you expected and what happened instead",
      "UNCHECKED 3: why it could not be tried",
    ].join("\n"),
  ].join("\n\n");

// `PASS 1: note` as asked for, or `1. PASS: note`, with whatever list or emphasis marks surround it.
const VERDICT_FIRST = /^\W*(PASS|FAIL|UNCHECKED)\W+(\d+)\b\W*(.*)$/i;
const NUMBER_FIRST = /^\W*(\d+)\W+(PASS|FAIL|UNCHECKED)\b\W*(.*)$/i;
const NOT_REPORTED = "The tester did not report on it.";

const verdictOf = (word: string): OzoneCriterionResult["verdict"] => {
  const lower = word.toLowerCase();
  return lower === "pass" ? "pass" : lower === "fail" ? "fail" : "unchecked";
};

const readLine = (line: string) => {
  const verdictFirst = VERDICT_FIRST.exec(line);
  if (verdictFirst !== null) {
    const [, word = "", position = "", note = ""] = verdictFirst;
    return { position: Number(position), verdict: verdictOf(word), note };
  }
  const numberFirst = NUMBER_FIRST.exec(line);
  if (numberFirst === null) return null;
  const [, position = "", word = "", note = ""] = numberFirst;
  return { position: Number(position), verdict: verdictOf(word), note };
};

/** One result per criterion, in order. A criterion the tester did not mention is `unchecked`. */
export const readVerdicts = (
  acceptance: ReadonlyArray<string>,
  reply: string,
): ReadonlyArray<OzoneCriterionResult> => {
  const reported = new Map<number, Pick<OzoneCriterionResult, "verdict" | "note">>();
  for (const line of reply.split("\n")) {
    const read = readLine(line.trim());
    // The last word on a criterion counts: a tester may correct itself.
    if (read !== null) {
      reported.set(read.position, {
        verdict: read.verdict,
        note: read.note.replace(/[*_`\s]+$/, ""),
      });
    }
  }
  return acceptance.map((criterion, index) => ({
    criterion,
    ...(reported.get(index + 1) ?? { verdict: "unchecked" as const, note: NOT_REPORTED }),
  }));
};
