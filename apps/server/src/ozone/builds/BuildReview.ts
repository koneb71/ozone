import type { OzoneAppError, OzoneBuild, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WAKE } from "./briefs.ts";
import * as BuildModel from "./BuildModel.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWake from "./BuildWake.ts";

/** The person's side of a plan that waits for approval. */
export class BuildReview extends Context.Service<
  BuildReview,
  {
    /** Lets the plan run and wakes the lead to start it. Does nothing for a plan not waiting. */
    readonly approve: (threadId: ThreadId) => Effect.Effect<OzoneBuild | null, OzoneAppError>;
  }
>()("t3/ozone/builds/BuildReview") {}

const make = Effect.gen(function* () {
  const store = yield* BuildStore.BuildStore;
  const wake = yield* BuildWake.BuildWake;

  return BuildReview.of({
    approve: Effect.fn("BuildReview.approve")(function* (threadId) {
      const at = DateTime.formatIso(yield* DateTime.now);
      const { build, approvedNow } = yield* store.modify(threadId, (current) => {
        const next = current === null ? null : BuildModel.approved(current, at);
        const approvedNow = next !== null && next !== current;
        return [{ build: next, approvedNow }, approvedNow ? next : null];
      });
      // Only a worker's own lead can start it, so the lead takes the first step, not this call.
      if (approvedNow) yield* wake.wake(threadId, WAKE.approved);
      return build;
    }),
  });
});

export const layer = Layer.effect(BuildReview, make);
