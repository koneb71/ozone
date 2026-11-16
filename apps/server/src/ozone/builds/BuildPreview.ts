import {
  ozoneAppUrl,
  type OzoneBuild,
  type PreviewSessionSnapshot,
  type ThreadId,
} from "@t3tools/contracts";
import { originOf } from "@t3tools/shared/preview";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as PreviewManager from "../../preview/Manager.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import { statusOf } from "./BuildModel.ts";
import * as BuildStore from "./BuildStore.ts";

/** Tabs the server runs that show the app. A tab on another site is the person's own browsing. */
const serverTabsShowing = (sessions: ReadonlyArray<PreviewSessionSnapshot>, appUrl: string) =>
  sessions.filter(
    (session) =>
      session.runtime === "server" &&
      session.navStatus._tag !== "Idle" &&
      originOf(session.navStatus.url) === originOf(appUrl),
  );

const progressOf = (build: OzoneBuild) =>
  `${build.tasks.filter((task) => task.status === "done").length}:${statusOf(build)}`;

/**
 * Reloads the preview when a build passes a task or completes. A page that failed while a worker
 * was mid-edit has no live reload in it and would stay on screen after the fix. Only tabs the
 * server runs are reloaded here, for every client watching them; a tab a client renders itself is
 * that client's to reload.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BuildStore.BuildStore;
    const registry = yield* AppRegistry.AppRegistry;
    const previews = yield* PreviewManager.PreviewManager;
    const seen = new Map<ThreadId, string>();

    const reload = Effect.fn("BuildPreview.reload")(function* (build: OzoneBuild) {
      const { app } = yield* registry.resolve(build.projectId);
      const { sessions } = yield* previews.list({ threadId: build.threadId });
      yield* Effect.forEach(
        serverTabsShowing(sessions, ozoneAppUrl(app)),
        (session) =>
          previews.adjust({ threadId: build.threadId, tabId: session.tabId, hardReload: true }),
        { discard: true },
      );
    });

    yield* store.saves.pipe(
      Stream.runForEach((build) => {
        const progress = progressOf(build);
        const before = seen.get(build.threadId);
        seen.set(build.threadId, progress);
        // The first save seen is where the build stands, not a step forward.
        return before === undefined || before === progress
          ? Effect.void
          : reload(build).pipe(Effect.ignore);
      }),
      Effect.forkScoped,
    );
  }),
);
