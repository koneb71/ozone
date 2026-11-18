#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { APP_SKILLS_DIR, appSkills, type AppSkill } from "./lib/app-skills.ts";

export class AppSkillSyncError extends Schema.TaggedError<AppSkillSyncError>()(
  "AppSkillSyncError",
  { skillId: Schema.String, step: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Syncing the app skill "${this.skillId}" failed while ${this.step}: ${this.detail}`;
  }
}

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (all, chunk) => all + chunk,
    ),
  );

const git = Effect.fn("syncAppSkills.git")(function* (
  skill: AppSkill,
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failed = (detail: string) =>
    new AppSkillSyncError({ skillId: skill.id, step: `git ${args[0]}`, detail });
  const child = yield* spawner
    .spawn(ChildProcess.make("git", [...args], { cwd }))
    .pipe(Effect.mapError((cause) => failed(String(cause))));
  const [stderr, code] = yield* Effect.all(
    [text(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => failed(String(cause))));
  if (code !== 0) return yield* failed(stderr.trim());
});

/** Fetches only the pinned commit, then replaces the skill's folder with the listed paths. */
const syncOne = Effect.fn("syncAppSkills.one")(function* (rootDir: string, skill: AppSkill) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fsFailed = (step: string) =>
    Effect.mapError(
      (cause: unknown) => new AppSkillSyncError({ skillId: skill.id, step, detail: String(cause) }),
    );
  const checkout = yield* fs
    .makeTempDirectoryScoped({ prefix: `ozone-skill-${skill.id}-` })
    .pipe(fsFailed("making a folder"));
  yield* git(skill, checkout, ["init", "--quiet"]);
  yield* git(skill, checkout, ["fetch", "--quiet", "--depth=1", skill.repository, skill.commit]);
  yield* git(skill, checkout, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "--quiet",
    "FETCH_HEAD",
  ]);

  const target = path.join(rootDir, APP_SKILLS_DIR, skill.id);
  const copies = [
    ...skill.include.map((entry) => ({ from: path.join(skill.root, entry), to: entry })),
    ...(skill.extras ?? []),
  ];
  yield* fs.remove(target, { recursive: true, force: true }).pipe(fsFailed("clearing it"));
  for (const copy of copies) {
    const from = path.join(checkout, copy.from);
    const to = path.join(target, copy.to);
    yield* fs.makeDirectory(path.dirname(to), { recursive: true }).pipe(fsFailed("copying"));
    yield* fs.copy(from, to).pipe(fsFailed(`copying ${copy.from}`));
  }
  yield* Console.log(`${skill.id}: ${copies.length} paths from ${skill.commit.slice(0, 12)}.`);
});

export const syncAppSkills = Effect.fn("syncAppSkills")(function* (options: {
  readonly rootDir?: string | undefined;
  readonly skillId?: string | undefined;
}) {
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const chosen =
    options.skillId === undefined
      ? appSkills
      : appSkills.filter((skill) => skill.id === options.skillId);
  if (chosen.length === 0) {
    return yield* new AppSkillSyncError({
      skillId: options.skillId ?? "",
      step: "choosing it",
      detail: `expected one of ${appSkills.map((skill) => skill.id).join(", ")}`,
    });
  }
  for (const skill of chosen) yield* syncOne(rootDir, skill).pipe(Effect.scoped);
});

const syncAppSkillsCommand = Command.make(
  "sync-app-skills",
  {
    skill: Flag.String("skill").pipe(
      Flag.withDescription("Sync only the named skill. Defaults to all of them."),
      Flag.optional,
    ),
    root: Flag.String("root").pipe(Flag.withDescription("Workspace root."), Flag.optional),
  },
  ({ skill, root }) =>
    syncAppSkills({ skillId: Option.getOrUndefined(skill), rootDir: Option.getOrUndefined(root) }),
).pipe(
  Command.withDescription(
    "Copy the agent skills apps get from their pinned upstream commits. Review the diff, then commit.",
  ),
);

if (import.meta.main) {
  Command.run(syncAppSkillsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
