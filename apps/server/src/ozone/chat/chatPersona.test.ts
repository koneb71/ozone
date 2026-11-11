import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ChatPersona from "./chatPersona.ts";

const withFolder = <A, E>(
  use: (input: {
    readonly folder: string;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly write: (folder: Option.Option<string>) => Effect.Effect<void>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ozone-chat-" });
    return yield* use({ folder, fileSystem, path, write: ChatPersona.writeInto(fileSystem, path) });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("a chat's folder gets one text that every provider loads", () =>
  withFolder(({ folder, fileSystem, path, write }) =>
    Effect.gen(function* () {
      yield* write(Option.some(folder));

      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(folder, "AGENTS.md")),
        ChatPersona.OZONE_CHAT_INSTRUCTIONS,
      );
      // Claude Code reads CLAUDE.md only, and follows an @import.
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(folder, "CLAUDE.md")),
        "@AGENTS.md\n",
      );
    }),
  ),
);

it.effect("a thread that is not a chat gets nothing", () =>
  withFolder(({ folder, fileSystem, write }) =>
    Effect.gen(function* () {
      yield* write(Option.none());

      assert.deepStrictEqual(yield* fileSystem.readDirectory(folder), []);
    }),
  ),
);

it.effect("a chat still starts when its instructions cannot be written", () =>
  withFolder(({ folder, path, write }) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(write(Option.some(path.join(folder, "missing"))));

      assert.strictEqual(exit._tag, "Success");
    }),
  ),
);
