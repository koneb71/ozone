import { assert, it } from "@effect/vitest";
import {
  NO_OZONE_VERIFICATION,
  PreviewTabId,
  ProjectId,
  ThreadId,
  type OzoneBuild,
  type OzoneBuildTask,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as PreviewManager from "../../preview/Manager.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildPreview from "./BuildPreview.ts";
import * as BuildStore from "./BuildStore.ts";

const threadId = ThreadId.make("thread-lead");
const projectId = ProjectId.make("project-notes");

const tab = (
  tabId: string,
  url: string | null,
  runtime: "server" | "desktop",
): PreviewSessionSnapshot =>
  ({
    threadId,
    tabId: PreviewTabId.make(tabId),
    navStatus: url === null ? { _tag: "Idle" } : { _tag: "Success", url, title: "" },
    canGoBack: false,
    canGoForward: false,
    runtime,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as PreviewSessionSnapshot;

const task = (id: string, status: OzoneBuildTask["status"]): OzoneBuildTask => ({
  id,
  title: `Task ${id}`,
  brief: "",
  dependsOn: [],
  acceptance: [],
  access: "write",
  status,
  attempts: 0,
  dispatches: 0,
  workerTaskId: null,
  workerThreadId: null,
  baseSha: null,
  commitSha: null,
  snapshotId: null,
  evidence: [],
  summary: null,
  blockedReason: null,
});

const build = (...statuses: ReadonlyArray<OzoneBuildTask["status"]>): OzoneBuild => ({
  threadId,
  projectId,
  spec: "",
  acceptance: [],
  tasks: statuses.map((status, index) => task(`t${index}`, status)),
  maxAttempts: 3,
  finalEvidence: [],
  completedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  approval: "not_needed",
  planGranted: false,
  finalStartedAt: null,
  verification: NO_OZONE_VERIFICATION,
});

// A page that failed while a worker was mid-edit stays on screen after the fix unless it is reloaded.
it.effect("reloads the server's tabs that show the app when a task passes", () =>
  Effect.gen(function* () {
    const saves = yield* Queue.unbounded<OzoneBuild>();
    const reloaded = yield* Queue.unbounded<string>();
    const layer = BuildPreview.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(BuildStore.BuildStore)({ saves: Stream.fromQueue(saves) }),
          Layer.mock(AppRegistry.AppRegistry)({
            resolve: () => Effect.succeed({ app: { port: 41000 } } as AppRegistry.ResolvedApp),
          }),
          Layer.mock(PreviewManager.PreviewManager)({
            list: () =>
              Effect.succeed({
                sessions: [
                  tab("app-error", "http://localhost:41000/sign-in", "server"),
                  tab("docs", "https://tanstack.com/start", "server"),
                  tab("blank", null, "server"),
                  tab("other-app", "http://localhost:41001/", "server"),
                  // A tab a client renders is that client's to reload.
                  tab("desktop", "http://localhost:41000/", "desktop"),
                ],
                serverEpoch: "epoch",
                revision: 0,
              }),
            adjust: (input) =>
              Queue.offer(reloaded, `${input.tabId}:${input.hardReload === true}`).pipe(
                Effect.as(tab(input.tabId, null, "server")),
              ),
          }),
        ),
      ),
    );
    yield* Layer.build(layer);

    // The first save seen is where the build stands, not a step forward.
    yield* Queue.offer(saves, build("running", "pending"));
    // A save that moves nothing forward reloads nothing.
    yield* Queue.offer(saves, build("checking", "pending"));
    yield* Queue.offer(saves, build("done", "pending"));

    assert.strictEqual(yield* Queue.take(reloaded), "app-error:true");
    yield* Queue.offer(saves, build("done", "done"));
    assert.strictEqual(yield* Queue.take(reloaded), "app-error:true");
    assert.strictEqual(yield* Queue.size(reloaded), 0);
  }),
);
