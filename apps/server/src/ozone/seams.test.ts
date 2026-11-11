import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const SEAM_TAG = "ozone-seam";

const OZONE_OWNED: ReadonlyArray<RegExp> = [
  /^docs\/ozone\//,
  /^apps\/server\/src\/ozone\//,
  /^apps\/server\/scripts\/ozone-/,
  /^apps\/web\/src\/ozone\//,
  /^packages\/ozone-templates\//,
  /^packages\/contracts\/src\/ozone/,
  /^packages\/client-runtime\/src\/state\/ozone/,
  /^\.github\/workflows\/ozone-/,
];

const isOzoneOwned = (file: string) => OZONE_OWNED.some((pattern) => pattern.test(file));

/** Paths in the first column of the table under `## <heading>`. */
const listedUnder = (markdown: string, heading: string): ReadonlyArray<string> => {
  const section = markdown.split(/^## /m).find((part) => part.startsWith(`${heading}\n`)) ?? "";
  return [...section.matchAll(/^\| `([^`]+)`\s*\|/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
};

it.live("SEAMS.md lists exactly the upstream files tagged ozone-seam", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* path.fromFileUrl(new URL("../../../../", import.meta.url));

    const registry = yield* fs.readFileString(path.join(root, "docs/ozone/SEAMS.md"));
    const tagged = (yield* spawner.lines(
      ChildProcess.make("git", ["grep", "--untracked", "-l", SEAM_TAG], { cwd: root }),
    ))
      .map((line) => line.trim())
      .filter((file) => file.length > 0 && !isOzoneOwned(file))
      .toSorted();

    assert.deepStrictEqual(tagged, listedUnder(registry, "Tagged").toSorted());

    const untagged = listedUnder(registry, "Untagged");
    const missing = yield* Effect.filter(untagged, (file) =>
      fs.exists(path.join(root, file)).pipe(Effect.map((exists) => !exists)),
    );
    assert.deepStrictEqual(missing, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
