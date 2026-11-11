import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";

export interface RepoCommit {
  readonly sha: string;
  readonly subject: string;
  readonly committedAt: string;
}

/**
 * What Ozone needs from an app's Git repository, for its builds and its history. Every answer
 * degrades instead of failing.
 */
export class BuildRepo extends Context.Service<
  BuildRepo,
  {
    readonly head: (workspaceRoot: string) => Effect.Effect<string | null>;
    /** True when `commitSha` is `of` or comes before it. `of` is HEAD unless given. */
    readonly isInHistory: (
      workspaceRoot: string,
      commitSha: string,
      of?: string,
    ) => Effect.Effect<boolean>;
    /** Commits from `from` (HEAD unless given) back, newest first. */
    readonly log: (
      workspaceRoot: string,
      options: { readonly limit: number; readonly from?: string },
    ) => Effect.Effect<ReadonlyArray<RepoCommit>>;
    /**
     * Makes the working tree what it was at `commitSha` and commits that as a new commit, so
     * nothing after it leaves the history. Returns the new head, or null when it failed.
     */
    readonly restoreTree: (
      workspaceRoot: string,
      commitSha: string,
      message: string,
    ) => Effect.Effect<string | null>;
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

// Characters git never puts in a subject or a date, so a log can be split on them.
const FIELD = "\x1f";
const RECORD = "\x1e";

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
    isInHistory: Effect.fn("BuildRepo.isInHistory")((workspaceRoot, commitSha, of) =>
      run(workspaceRoot, "isInHistory", [
        "merge-base",
        "--is-ancestor",
        commitSha,
        of ?? "HEAD",
      ]).pipe(Effect.map((result) => result.code === 0)),
    ),
    log: Effect.fn("BuildRepo.log")((workspaceRoot, options) =>
      run(workspaceRoot, "log", [
        "log",
        `--max-count=${options.limit}`,
        `--format=%H${FIELD}%s${FIELD}%cI${RECORD}`,
        options.from ?? "HEAD",
        "--",
      ]).pipe(
        Effect.map((result) =>
          result.code !== 0
            ? []
            : result.stdout.split(RECORD).flatMap((record) => {
                const [sha = "", subject = "", committedAt = ""] = record.trim().split(FIELD);
                return sha.length === 0 ? [] : [{ sha, subject, committedAt }];
              }),
        ),
      ),
    ),
    restoreTree: Effect.fn("BuildRepo.restoreTree")(function* (workspaceRoot, commitSha, message) {
      // Tracked files that came later are removed; the index and the tree become that commit's.
      const read = yield* run(workspaceRoot, "restoreTree", [
        "read-tree",
        "-u",
        "--reset",
        commitSha,
      ]);
      if (read.code !== 0) return null;
      const committed = yield* run(workspaceRoot, "commit", [
        "commit",
        "--allow-empty",
        "--message",
        message,
      ]);
      return committed.code === 0 ? yield* head(workspaceRoot) : null;
    }),
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
