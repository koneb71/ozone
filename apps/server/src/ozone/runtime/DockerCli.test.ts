import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ProcessRunner from "../../processRunner.ts";
import * as DockerCli from "./DockerCli.ts";

const APP = ["compose", "--project-directory", "/apps/down", "-f", "/apps/rm/compose.yaml"];

describe("DockerCli", () => {
  it.each<readonly [ReadonlyArray<string>, boolean]>([
    [["volume", "rm", "habits_pgdata"], true],
    [["volume", "remove", "habits_pgdata"], true],
    [["volume", "prune", "--force"], true],
    [["system", "prune", "--volumes"], true],
    [["--context", "desktop", "volume", "rm", "habits_pgdata"], true],
    [[...APP, "down", "--volumes"], true],
    [[...APP, "down", "-v"], true],
    [[...APP, "rm", "-fsv"], true],
    [[...APP, "down"], false],
    [[...APP, "down", "--remove-orphans", "--rmi", "local"], false],
    [["-H", "ssh://deploy@example.com", "volume", "rm", "notes-prod_pgdata"], true],
    [[...APP, "stop"], false],
    [[...APP, "up", "--detach", "--build", "--force-recreate"], false],
    [["system", "prune"], false],
    [["volume", "ls"], false],
    [["ps", "--all"], false],
    // What runs inside the container is the app's business, not a Docker command.
    [[...APP, "exec", "-T", "app", "sh", "-lc", "docker compose down -v"], false],
    [[...APP, "exec", "-T", "app", "rm", "-v", "notes.txt"], false],
  ])("removesData(%j) is %s", (args, expected) => {
    assert.strictEqual(DockerCli.removesData(args), expected);
  });

  it.effect("refuses a command that removes data unless the caller is the delete flow", () =>
    Effect.gen(function* () {
      const ran = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
      const docker = yield* DockerCli.make.pipe(
        Effect.provide(
          Layer.mock(ProcessRunner.ProcessRunner)({
            run: (input) =>
              Ref.update(ran, (calls) => [...calls, input.args]).pipe(
                Effect.as({
                  stdout: "",
                  stderr: "",
                  code: null,
                  timedOut: false,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                  stdoutInvalidUtf8: false,
                  stderrInvalidUtf8: false,
                }),
              ),
          }),
        ),
      );

      const refused = yield* Effect.exit(docker.run({ args: [...APP, "down", "--volumes"] }));
      assert.isTrue(Exit.isFailure(refused) && Exit.hasDies(refused));
      assert.deepStrictEqual(yield* Ref.get(ran), []);

      yield* docker.run({ args: ["volume", "rm", "habits_pgdata"], allowDataRemoval: true });
      assert.deepStrictEqual(yield* Ref.get(ran), [["volume", "rm", "habits_pgdata"]]);
    }),
  );

  // docs/ozone/data-safety.md: a volume goes only after a person confirms Delete app or Delete
  // deployment, each behind a snapshot. A third asker is a change to that contract.
  it.effect("is let past by exactly the two flows a person confirms", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const ozone = path.join(import.meta.dirname, "..");
      const askers: Array<string> = [];
      for (const file of yield* fs.readDirectory(ozone, { recursive: true })) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const text = yield* fs.readFileString(path.join(ozone, file));
        const count = text.split("allowDataRemoval: true").length - 1;
        for (let index = 0; index < count; index += 1) askers.push(file.split(path.sep).join("/"));
      }
      assert.deepStrictEqual(askers.toSorted(), ["data/AppData.ts", "deploy/AppDeploy.ts"]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
