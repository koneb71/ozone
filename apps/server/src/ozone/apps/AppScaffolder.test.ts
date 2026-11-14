import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { OZONE_APP_INSTRUCTIONS } from "./appInstructions.ts";
import { addWindowsHelper, appSlug, safeAppName, scaffold } from "./AppScaffolder.ts";
import { readTemplateTree } from "./templates.ts";

describe("AppScaffolder", () => {
  it.each([
    ["Habit tracker", "Habit tracker"],
    ["  spaced\n out  ", "spaced out"],
    // Whatever could close a tag, a string or a template in source is dropped.
    ['</title><script>alert("x")</script>', "/titlescriptalert(x)/script"],
    ["`${process.env.SECRET}`", "process.env.SECRET"],
    ["   ", "My app"],
  ])("safeAppName(%j) is %j", (name, expected) => {
    assert.strictEqual(safeAppName(name), expected);
  });

  it.each([
    ["Habit Tracker", "A1B2C3D4-0000", "habit-tracker-a1b2c3"],
    ["  --Ünïcode & symbols!--  ", "p9", "n-code-symbols-p9"],
    ["???", "abc", "app-abc"],
    ["x".repeat(80), "id", `${"x".repeat(40)}-id`],
  ])("appSlug(%j, %j) is %j", (folder, suffix, expected) => {
    assert.strictEqual(appSlug(folder, suffix), expected);
    // Docker Compose rejects any other project name.
    assert.match(appSlug(folder, suffix), /^[a-z0-9][a-z0-9_-]*$/);
  });

  it.effect("fills a template with the app's name, slug and local settings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-scaffold-" });
      const template = path.join(root, "template");
      const workspaceRoot = path.join(root, "app");
      const binary = new Uint8Array([0, 255, 1, 2, 95, 95]);
      yield* fs.makeDirectory(path.join(template, "src", "routes"), { recursive: true });
      yield* fs.makeDirectory(workspaceRoot);
      yield* fs.writeFileString(path.join(template, "compose.yaml"), "name: __OZONE_APP_SLUG__\n");
      yield* fs.writeFileString(
        path.join(template, "src", "routes", "index.tsx"),
        "<h1>__OZONE_APP_NAME__</h1>",
      );
      yield* fs.writeFileString(
        path.join(template, "AGENTS.md"),
        "# __OZONE_APP_NAME__\n\n## Ozone\n\n<!-- ozone:instructions -->\n",
      );
      yield* fs.writeFileString(path.join(template, "dev"), "#!/bin/sh\n");
      yield* fs.chmod(path.join(template, "dev"), 0o755);
      yield* fs.writeFile(path.join(template, "logo.bin"), binary);

      const written = yield* scaffold({
        files: yield* readTemplateTree(template),
        workspaceRoot,
        name: "Habit tracker",
        slug: "habit-tracker-a1b2c3",
        port: 41_007,
        userId: 501,
        groupId: 20,
        authSecret: "secret",
      });

      assert.deepStrictEqual(written, [
        "AGENTS.md",
        "compose.yaml",
        "dev",
        "logo.bin",
        "src/routes/index.tsx",
      ]);
      const read = (file: string) => fs.readFileString(path.join(workspaceRoot, file));
      assert.strictEqual(yield* read("compose.yaml"), "name: habit-tracker-a1b2c3\n");
      assert.strictEqual(yield* read("src/routes/index.tsx"), "<h1>Habit tracker</h1>");
      assert.strictEqual(
        yield* read("AGENTS.md"),
        `# Habit tracker\n\n## Ozone\n\n${OZONE_APP_INSTRUCTIONS}\n`,
      );
      assert.strictEqual(
        yield* read(".env"),
        [
          "# Written by Ozone for this machine. Not committed.",
          "OZONE_APP_PORT=41007",
          "OZONE_UID=501",
          "OZONE_GID=20",
          "BETTER_AUTH_SECRET=secret",
          "",
        ].join("\n"),
      );
      assert.deepStrictEqual(yield* fs.readFile(path.join(workspaceRoot, "logo.bin")), binary);
      // Entry points stay executable.
      assert.strictEqual((yield* fs.stat(path.join(workspaceRoot, "dev"))).mode & 0o111, 0o111);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("adds the Windows helper to an app that lacks it, on Windows only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-helper-" });
      const helper = path.join(workspaceRoot, "dev.cmd");
      const add = (platform: NodeJS.Platform) =>
        addWindowsHelper({ platform, workspaceRoot, templateId: "web-app" });

      // Not an Ozone app's folder: nothing to pair the helper with.
      assert.isFalse(yield* add("win32"));
      yield* fs.writeFileString(path.join(workspaceRoot, "dev"), "#!/bin/sh\n");
      assert.isFalse(yield* add("darwin"));
      assert.isFalse(yield* fs.exists(helper));

      assert.isTrue(yield* add("win32"));
      assert.include(yield* fs.readFileString(helper), "docker compose %OZONE_DEV_MODE% app %*");

      yield* fs.writeFileString(helper, "mine");
      assert.isFalse(yield* add("win32"));
      assert.strictEqual(yield* fs.readFileString(helper), "mine");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
