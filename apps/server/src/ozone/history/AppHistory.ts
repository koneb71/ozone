import {
  OzoneAppError,
  type OzoneBuild,
  type OzoneHistoryListResult,
  type OzoneHistoryRestoreInput,
  type OzoneHistoryRestoreResult,
  type OzoneSnapshot,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as AppRegistry from "../apps/AppRegistry.ts";
import * as BuildModel from "../builds/BuildModel.ts";
import * as BuildRepo from "../builds/BuildRepo.ts";
import * as BuildStore from "../builds/BuildStore.ts";
import * as AppData from "../data/AppData.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { failed } from "../errors.ts";

/**
 * An app's past, one commit per passed task, and the way back to any point of it: the code and
 * the data together. Going back is itself a commit, so it can be undone the same way.
 */
export class AppHistory extends Context.Service<
  AppHistory,
  {
    readonly list: (projectId: ProjectId) => Effect.Effect<OzoneHistoryListResult, OzoneAppError>;
    readonly restore: (
      input: OzoneHistoryRestoreInput,
    ) => Effect.Effect<OzoneHistoryRestoreResult, OzoneAppError>;
  }
>()("t3/ozone/history/AppHistory") {}

const HISTORY_LENGTH = 50;

/** Work that a restore would pull the files out from under. */
const isBusy = (build: OzoneBuild) =>
  build.tasks.some((task) => task.status === "running" || task.status === "checking") ||
  build.finalStartedAt !== null ||
  build.verification.status === "running";

/** The newest snapshot taken at each commit: the data as it last was with that code. */
const snapshotsByCommit = (snapshots: ReadonlyArray<OzoneSnapshot>) => {
  const byCommit = new Map<string, OzoneSnapshot>();
  for (const snapshot of snapshots.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (snapshot.commitSha !== null && !byCommit.has(snapshot.commitSha)) {
      byCommit.set(snapshot.commitSha, snapshot);
    }
  }
  return byCommit;
};

const make = Effect.gen(function* () {
  const registry = yield* AppRegistry.AppRegistry;
  const repo = yield* BuildRepo.BuildRepo;
  const data = yield* AppData.AppData;
  const runtime = yield* AppRuntime.AppRuntime;
  const store = yield* BuildStore.BuildStore;
  const restoring = yield* Semaphore.make(1);
  const scope = yield* Scope.Scope;

  /** Each build's plan, told which tasks' work the restored point has and which it lacks. */
  const rewind = Effect.fn("AppHistory.rewind")(function* (
    workspaceRoot: string,
    builds: ReadonlyArray<OzoneBuild>,
    sha: string,
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    for (const build of builds) {
      const undone: Array<string> = [];
      const redone: Array<string> = [];
      for (const task of build.tasks) {
        if (task.commitSha === null || (task.status !== "done" && task.status !== "pending")) {
          continue;
        }
        const present = yield* repo.isInHistory(workspaceRoot, task.commitSha, sha);
        if (task.status === "done" && !present) undone.push(task.id);
        if (task.status === "pending" && present) redone.push(task.id);
      }
      if (undone.length === 0 && redone.length === 0) continue;
      yield* store.modify(build.threadId, (current) => [
        null,
        current === null ? null : BuildModel.rewound(current, { undone, redone }, at),
      ]);
    }
  });

  const restore = Effect.fn("AppHistory.restore")(function* (input: OzoneHistoryRestoreInput) {
    const app = yield* registry.resolve(input.projectId);
    const root = app.workspaceRoot;
    const builds = (yield* store.list).filter((build) => build.projectId === input.projectId);
    if (builds.some(isBusy)) {
      return yield* failed(
        "A build is working on this app. Restore it when the build has stopped.",
      );
    }
    const head = yield* repo.head(root);
    if (head === null) return yield* failed("This app has no history to go back to.");
    const [target] = yield* repo.log(root, { limit: 1, from: input.sha });
    if (target === undefined || !(yield* repo.isInHistory(root, input.sha))) {
      return yield* failed("That point is not in this app's history.");
    }
    const changed = yield* repo.hasChanges(root);
    if (input.sha === head && !changed) return yield* failed("The app is already at that point.");

    // What is there now is kept, so this restore can be undone like any other.
    if (changed) yield* repo.commitAll(root, `Changes before restoring "${target.subject}"`);
    const snapshot = snapshotsByCommit(yield* data.list(input.projectId)).get(input.sha) ?? null;
    // Stopped until code and data match again: started on the newer code, the app would migrate
    // the restored data forward, and a data restore leaves a stopped app stopped.
    const stopped = yield* runtime.act({ projectId: input.projectId, action: "stop" });
    if (stopped.phase === "failed") {
      return yield* failed(
        `The app could not be stopped, so nothing was restored. ${stopped.message ?? ""}`.trim(),
      );
    }
    // Data first: its safety snapshot is then filed under the commit whose data it holds.
    const safety =
      snapshot === null
        ? null
        : (yield* data.restore({ projectId: input.projectId, snapshotId: snapshot.id })).safety;
    const commitSha = yield* repo.restoreTree(
      root,
      input.sha,
      `Restore "${target.subject}"\n\nOzone restored the code of ${input.sha.slice(0, 7)}.`,
    );
    if (commitSha === null) {
      return yield* failed(
        safety === null
          ? "The code could not be restored. Nothing was changed."
          : `The data was restored, but the code could not be. The data from before is in snapshot ${safety.id}.`,
      );
    }
    yield* rewind(root, builds, input.sha);
    // Dependencies may differ at that point, and the app installs them when it starts.
    yield* runtime.act({ projectId: input.projectId, action: "up" }).pipe(Effect.ignore);
    return { commitSha, safety };
  });

  return AppHistory.of({
    list: Effect.fn("AppHistory.list")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      const commits = yield* repo.log(app.workspaceRoot, { limit: HISTORY_LENGTH });
      const snapshots = snapshotsByCommit(yield* data.list(projectId));
      return {
        entries: commits.map((commit) => ({
          ...commit,
          snapshot: snapshots.get(commit.sha) ?? null,
        })),
      };
    }),
    // A restore runs to its end in the service's own fiber: a caller that goes away halfway
    // would leave the data of one point under the code of another.
    restore: Effect.fn("AppHistory.restore")((input) =>
      Effect.forkIn(restoring.withPermits(1)(restore(input)), scope).pipe(
        Effect.flatMap(Fiber.join),
      ),
    ),
  });
});

export const layer = Layer.effect(AppHistory, make);
