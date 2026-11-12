import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as AppRegistry from "../apps/AppRegistry.ts";
import { statusOf } from "../builds/BuildModel.ts";
import * as BuildStore from "../builds/BuildStore.ts";
import * as AppDeploy from "./AppDeploy.ts";

/**
 * Deploys an app when one of its builds completes, where it was last deployed, for apps whose
 * settings ask for it. A build seen complete when Ozone starts is not a new one.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BuildStore.BuildStore;
    const registry = yield* AppRegistry.AppRegistry;
    const deploys = yield* AppDeploy.AppDeploy;
    const complete = new Map<ThreadId, boolean>();

    yield* store.saves.pipe(
      Stream.runForEach((build) => {
        const now = statusOf(build) === "complete";
        const before = complete.get(build.threadId);
        complete.set(build.threadId, now);
        if (!now || before !== false) return Effect.void;
        return registry.resolve(build.projectId).pipe(
          Effect.flatMap((app) =>
            app.app.settings.deployOnBuild
              ? deploys.redeploy(build.projectId, "build").pipe(Effect.forkDetach, Effect.asVoid)
              : Effect.void,
          ),
          Effect.catch((cause) =>
            Effect.logWarning("Ozone could not deploy a completed build", cause),
          ),
        );
      }),
      Effect.forkScoped,
    );
  }),
);
