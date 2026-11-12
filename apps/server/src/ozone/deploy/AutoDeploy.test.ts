import { assert, it } from "@effect/vitest";
import {
  DEFAULT_OZONE_APP_SETTINGS,
  NO_OZONE_VERIFICATION,
  ProjectId,
  ThreadId,
  type OzoneBuild,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildStore from "../builds/BuildStore.ts";
import * as AppDeploy from "./AppDeploy.ts";
import * as AutoDeploy from "./AutoDeploy.ts";

const projectId = ProjectId.make("project-notes");
const build = (thread: string, completedAt: string | null): OzoneBuild => ({
  threadId: ThreadId.make(thread),
  projectId,
  spec: "",
  acceptance: [],
  tasks: [
    {
      id: "t1",
      title: "Task",
      brief: "",
      dependsOn: [],
      acceptance: [],
      access: "write",
      status: "done",
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
    },
  ],
  maxAttempts: 3,
  finalEvidence: [],
  completedAt,
  updatedAt: "2026-01-01T00:00:00.000Z",
  approval: "not_needed",
  finalStartedAt: null,
  verification: NO_OZONE_VERIFICATION,
});

const run = (deployOnBuild: boolean) =>
  Effect.gen(function* () {
    const saves = yield* Queue.unbounded<OzoneBuild>();
    const deployed = yield* Queue.unbounded<string>();
    yield* Layer.build(
      AutoDeploy.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(BuildStore.BuildStore)({ saves: Stream.fromQueue(saves) }),
            Layer.mock(AppRegistry.AppRegistry)({
              resolve: () =>
                Effect.succeed({
                  app: { settings: { ...DEFAULT_OZONE_APP_SETTINGS, deployOnBuild } },
                } as AppRegistry.ResolvedApp),
            }),
            Layer.mock(AppDeploy.AppDeploy)({
              redeploy: (id, trigger) =>
                Queue.offer(deployed, `${id} ${trigger}`).pipe(Effect.andThen(Effect.never)),
            }),
          ),
        ),
      ),
    );
    return { saves, deployed };
  });

it.effect("deploys when a build completes, for an app that asks for it", () =>
  Effect.gen(function* () {
    const { saves, deployed } = yield* run(true);
    // Complete already when first seen: not a build that just completed.
    yield* Queue.offer(saves, build("old", "2026-01-01T00:00:00.000Z"));
    yield* Queue.offer(saves, build("lead", null));
    yield* Queue.offer(saves, build("lead", "2026-01-02T00:00:00.000Z"));
    assert.strictEqual(yield* Queue.take(deployed), "project-notes build");
    // Saved again while complete: no second deploy.
    yield* Queue.offer(saves, build("lead", "2026-01-02T00:00:00.000Z"));
    yield* Queue.offer(saves, build("other", null));
    yield* Queue.offer(saves, build("other", "2026-01-03T00:00:00.000Z"));
    assert.strictEqual(yield* Queue.take(deployed), "project-notes build");
    assert.strictEqual(yield* Queue.size(deployed), 0);

    const off = yield* run(false);
    yield* Queue.offer(off.saves, build("lead", null));
    yield* Queue.offer(off.saves, build("lead", "2026-01-02T00:00:00.000Z"));
    yield* Queue.offer(off.saves, build("probe", null));
    yield* Queue.offer(off.saves, build("probe", "2026-01-02T00:00:00.000Z"));
    assert.strictEqual(yield* Queue.size(off.deployed), 0);
  }),
);
