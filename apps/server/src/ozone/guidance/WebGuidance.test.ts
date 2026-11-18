import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as WebGuidance from "./WebGuidance.ts";

// Reads the pinned package's own index and guides: a new version that moves them breaks this.
it.effect("searches and reads Chrome's web guidance on this machine", () =>
  Effect.gen(function* () {
    const guidance = yield* WebGuidance.WebGuidance;
    const matches = yield* guidance.search("light dismiss dialog");
    assert.isAtMost(matches.length, WebGuidance.SEARCH_LIMIT);
    assert.include(
      matches.map((match) => match.id),
      "light-dismiss-a-dialog",
    );

    const [guide] = yield* guidance.retrieve(["light-dismiss-a-dialog"]);
    assert.strictEqual(guide?.id, "light-dismiss-a-dialog");
    assert.include(guide?.guide ?? "", "closedby");

    const unknown = yield* Effect.flip(guidance.retrieve(["no-such-guide"]));
    assert.include(unknown.message, "Search first");
  }).pipe(Effect.provide(WebGuidance.layer.pipe(Layer.provide(NodeServices.layer)))),
);
