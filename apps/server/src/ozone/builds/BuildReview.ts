import type { OzoneAppError, OzoneBuild, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import { WAKE } from "./briefs.ts";
import * as BuildModel from "./BuildModel.ts";
import * as BuildStore from "./BuildStore.ts";
import * as BuildWake from "./BuildWake.ts";

/**
 * The person's side of a plan that waits for approval. Approving a plan also turns the app's
 * Plan first off, as leaving plan mode does in the agent: the next request is built, not planned.
 */
export class BuildReview extends Context.Service<
  BuildReview,
  {
    /** Lets the plan run and wakes the lead to start it. Does nothing for a plan not waiting. */
    readonly approve: (threadId: ThreadId) => Effect.Effect<OzoneBuild | null, OzoneAppError>;
    /**
     * Records that the person approved a plan the lead showed in plan mode, so the plan it files
     * next runs without a second approval. Null when the thread is not a lead's.
     */
    readonly grant: (threadId: ThreadId) => Effect.Effect<OzoneBuild | null, OzoneAppError>;
  }
>()("t3/ozone/builds/BuildReview") {}

const make = Effect.gen(function* () {
  const store = yield* BuildStore.BuildStore;
  const wake = yield* BuildWake.BuildWake;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const registry = yield* AppRegistry.AppRegistry;

  // The approval stands even when the setting cannot be saved.
  const stopPlanningFirst = (projectId: ProjectId) =>
    registry
      .configure(projectId, { reviewPlans: false })
      .pipe(
        Effect.catchCause((cause) => Effect.logWarning("Could not turn Plan first off.", cause)),
      );

  return BuildReview.of({
    approve: Effect.fn("BuildReview.approve")(function* (threadId) {
      const at = DateTime.formatIso(yield* DateTime.now);
      const { build, approvedNow } = yield* store.modify(threadId, (current) => {
        const next = current === null ? null : BuildModel.approved(current, at);
        const approvedNow = next !== null && next !== current;
        return [{ build: next, approvedNow }, approvedNow ? next : null];
      });
      // Only a worker's own lead can start it, so the lead takes the first step, not this call.
      if (approvedNow && build !== null) {
        yield* stopPlanningFirst(build.projectId);
        yield* wake.wake(threadId, WAKE.approved);
      }
      return build;
    }),
    grant: Effect.fn("BuildReview.grant")(function* (threadId) {
      const at = DateTime.formatIso(yield* DateTime.now);
      // The lead has filed nothing on its first plan, so the build may not exist yet.
      const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
      if (shell === null) return null;
      yield* stopPlanningFirst(shell.projectId);
      return yield* store.modify(threadId, (current) => {
        const next = BuildModel.granted(
          current ?? BuildModel.emptyBuild(threadId, shell.projectId, at),
          at,
        );
        return [next, next === current ? null : next];
      });
    }),
  });
});

export const layer = Layer.effect(BuildReview, make);
