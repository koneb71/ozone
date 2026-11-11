import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";

/** What a build needs from the app's Git repository. Every answer degrades instead of failing. */
export class BuildRepo extends Context.Service<
  BuildRepo,
  {
    readonly head: (workspaceRoot: string) => Effect.Effect<string | null>;
    readonly isInHistory: (workspaceRoot: string, commitSha: string) => Effect.Effect<boolean>;
    readonly hasChanges: (workspaceRoot: string) => Effect.Effect<boolean>;
    /** Stages everything. Run before reading what a task added. */
    readonly stageAll: (workspaceRoot: string) => Effect.Effect<void>;
    /** Files added since `base` under `directory`, counting staged ones. */
    readonly addedSince: (
      workspaceRoot: string,
      base: string,
      directory: string,
    ) => Effect.Effect<ReadonlyArray<string>>;
    /** Commits everything and returns the head, which is unchanged when there was nothing new. */
    readonly commitAll: (workspaceRoot: string, message: string) => Effect.Effect<string | null>;
    /** Moves uncommitted changes out of the tree without deleting them. */
    readonly setAside: (workspaceRoot: string, label: string) => Effect.Effect<void>;
  }
>()("t3/ozone/builds/BuildRepo") {}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;

  const run = (workspaceRoot: string, operation: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation: `BuildRepo.${operation}`,
        cwd: workspaceRoot,
        args,
        allowNonZeroExit: true,
        timeoutMs: 60_000,
      })
      .pipe(
        Effect.map((result) => ({ code: Number(result.exitCode), stdout: result.stdout })),
        Effect.orElseSucceed(() => ({ code: 1, stdout: "" })),
      );

  const head = (workspaceRoot: string) =>
    run(workspaceRoot, "head", ["rev-parse", "HEAD"]).pipe(
      Effect.map((result) => {
        const sha = result.stdout.trim();
        return result.code === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
      }),
    );
  const stageAll = (workspaceRoot: string) =>
    run(workspaceRoot, "stageAll", ["-c", "core.safecrlf=false", "add", "--all"]).pipe(
      Effect.asVoid,
    );

  return BuildRepo.of({
    head,
    stageAll,
    isInHistory: Effect.fn("BuildRepo.isInHistory")((workspaceRoot, commitSha) =>
      run(workspaceRoot, "isInHistory", ["merge-base", "--is-ancestor", commitSha, "HEAD"]).pipe(
        Effect.map((result) => result.code === 0),
      ),
    ),
    hasChanges: Effect.fn("BuildRepo.hasChanges")((workspaceRoot) =>
      run(workspaceRoot, "hasChanges", ["status", "--porcelain"]).pipe(
        Effect.map((result) => result.stdout.trim().length > 0),
      ),
    ),
    addedSince: Effect.fn("BuildRepo.addedSince")((workspaceRoot, base, directory) =>
      run(workspaceRoot, "addedSince", [
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=A",
        base,
        "--",
        directory,
      ]).pipe(
        Effect.map((result) =>
          result.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        ),
      ),
    ),
    commitAll: Effect.fn("BuildRepo.commitAll")(function* (workspaceRoot, message) {
      yield* stageAll(workspaceRoot);
      yield* run(workspaceRoot, "commit", ["commit", "--message", message]);
      return yield* head(workspaceRoot);
    }),
    setAside: Effect.fn("BuildRepo.setAside")((workspaceRoot, label) =>
      run(workspaceRoot, "setAside", [
        "stash",
        "push",
        "--include-untracked",
        "--message",
        label,
      ]).pipe(Effect.asVoid),
    ),
  });
});

export const layer = Layer.effect(BuildRepo, make);
