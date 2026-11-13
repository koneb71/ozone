import { OzoneAppError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type * as ProcessRunner from "../../processRunner.ts";

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

/** A remote another machine can clone: a path on this machine is not one. */
export const cloneableUrl = (url: string): boolean =>
  /^(?:https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/.test(url);

/** `owner/repo` of a GitHub remote in either spelling, or null for any other remote. */
export const githubRepoOf = (url: string): string | null => {
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      url,
    );
  return match?.[1] ?? null;
};

/**
 * Pushes a commit to the remote of the app's branch, for a builder that clones from there.
 * `builder` names it in what a person reads.
 */
export const publishCommit = Effect.fn("gitPublish.publishCommit")(function* (input: {
  readonly runner: ProcessRunner.ProcessRunner["Service"];
  readonly root: string;
  readonly commitSha: string;
  readonly builder: string;
  readonly note: (text: string) => Effect.Effect<void>;
}) {
  const { builder, commitSha, root } = input;
  const git = (args: ReadonlyArray<string>, timeout = Duration.seconds(30)) =>
    input.runner
      .run({
        command: "git",
        args: ["-C", root, ...args],
        timeout,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(Effect.mapError(() => failed("Ozone could not run git.")));

  const branch = (yield* git(["symbolic-ref", "--quiet", "--short", "HEAD"])).stdout.trim();
  if (branch.length === 0) {
    return yield* failed(`The app is not on a branch, so ${builder} has nothing to clone.`);
  }
  const configured = (yield* git(["config", `branch.${branch}.remote`])).stdout.trim();
  const remote = configured.length > 0 ? configured : "origin";
  const url = (yield* git(["remote", "get-url", remote])).stdout.trim();
  if (url.length === 0 || !cloneableUrl(url)) {
    return yield* failed(
      `${builder} builds the app from a Git remote it can clone, and this app has none. Use Create repository on the app's Deploy page, or add a remote such as a GitHub repository as its origin, then deploy again.`,
    );
  }
  yield* input.note(`$ git push ${remote} ${commitSha.slice(0, 7)}:refs/heads/${branch}`);
  const pushed = yield* git(
    ["push", remote, `${commitSha}:refs/heads/${branch}`],
    Duration.minutes(3),
  );
  const said = `${pushed.stdout}\n${pushed.stderr}`.trim();
  yield* input.note(said.slice(-4_000));
  if (pushed.code !== 0 || pushed.timedOut) {
    return yield* failed(
      /rejected|non-fast-forward|fetch first/i.test(said)
        ? `${remote} has commits this app does not, so Ozone did not push. Bring them in, then deploy again.\n${said.slice(-1_000)}`
        : `Ozone could not push to ${remote}, which ${builder} clones from. Check that git can push there from this computer.\n${said.slice(-1_000)}`,
    );
  }
  return { branch, url };
});
