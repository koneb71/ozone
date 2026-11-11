import { assert, it } from "@effect/vitest";

import { excerpt } from "./BuildGates.ts";

// A bundler prints its error first and a stack after it; a test runner ends with its summary.
it("keeps both ends of a long check output", () => {
  const output = [
    "error: Could not resolve ./missing from src/routes/index.tsx",
    ...Array.from({ length: 400 }, (_, index) => `    at frame ${index} (node_modules/x.js:1:1)`),
    "Build failed in 2.1s",
  ].join("\n");

  const kept = excerpt(output);

  assert.isBelow(kept.length, 2_100);
  assert.match(kept, /^error: Could not resolve \.\/missing/);
  assert.match(kept, /Build failed in 2\.1s$/);
  assert.strictEqual(excerpt("  short\n"), "short");
});
