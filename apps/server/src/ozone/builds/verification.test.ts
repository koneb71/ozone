import { assert, it } from "@effect/vitest";

import { readVerdicts } from "./verification.ts";

const CRITERIA = ["A habit can be added.", "A habit can be ticked.", "Streaks are shown."];

it("reads the tester's verdicts in the form asked for and the forms models drift to", () => {
  const reply = [
    "I opened the app and tried each criterion.",
    "",
    "PASS 1",
    "- **FAIL 2**: clicked the box, expected a tick, and nothing changed",
    "3. UNCHECKED: the page never loaded",
    "PASS 2",
  ].join("\n");
  assert.deepStrictEqual(readVerdicts(CRITERIA, reply), [
    { criterion: "A habit can be added.", verdict: "pass", note: "" },
    // The last word on a criterion counts.
    { criterion: "A habit can be ticked.", verdict: "pass", note: "" },
    { criterion: "Streaks are shown.", verdict: "unchecked", note: "the page never loaded" },
  ]);
  assert.deepStrictEqual(
    readVerdicts(CRITERIA, "FAIL 2: nothing happens").map((result) => result.verdict),
    ["unchecked", "fail", "unchecked"],
  );
  assert.strictEqual(readVerdicts(CRITERIA, "")[0]?.note, "The tester did not report on it.");
});
