import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveHostCliCommand, resolveRootCliCommand } from "./invocation.ts";

it.layer(NodeServices.layer)("root CLI commands", (it) => {
  const rootCommand = (input: {
    readonly node: string;
    readonly entry: string;
    readonly path?: string;
    readonly env?: Record<string, string>;
    readonly executable?: boolean;
    readonly args?: ReadonlyArray<string>;
  }) =>
    resolveRootCliCommand("browser setup", input.args).pipe(
      Effect.provideService(HostProcess.ExecutablePath, input.node),
      Effect.provideService(HostProcess.Arguments, [input.node, input.entry]),
      Effect.provideService(HostProcess.IsExecutable, input.executable ?? false),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: input.path ?? "", ...input.env }),
    );

  const pathWithT3 = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bin = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(path.join(bin, "ozone"), "#!/bin/sh\n", { mode: 0o755 });
    return bin;
  });

  it.effect("keeps a user-installed Node reachable when the command runs under sudo", () =>
    Effect.gen(function* () {
      const npx = "/home/theo/.npm/_npx/abc/node_modules/t3/dist/bin.mjs";
      expect(yield* rootCommand({ node: "/usr/bin/node", entry: npx })).toBe(
        "sudo ozone browser setup",
      );
      expect(
        yield* rootCommand({ node: "/home/theo/.nvm/versions/node/v24/bin/node", entry: npx }),
      ).toBe('sudo env "PATH=$PATH" ozone browser setup');
      expect(
        yield* rootCommand({
          node: "/home/theo/.local/node/bin/node",
          entry: "/home/theo/.local/lib/node_modules/t3/dist/bin.mjs",
          path: yield* pathWithT3,
        }),
      ).toBe('sudo env "PATH=$PATH" ozone browser setup');
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the arguments, so root runs setup on the same Ozone home", () =>
    Effect.gen(function* () {
      const args = ["--base-dir", "/srv/ozone home"];
      expect(
        yield* rootCommand({
          node: "/home/theo/.local/node/bin/node",
          entry: "/home/theo/.local/lib/node_modules/t3/dist/bin.mjs",
          path: yield* pathWithT3,
          args,
        }),
      ).toBe(`sudo env "PATH=$PATH" ozone browser setup --base-dir '/srv/ozone home'`);
      expect(
        yield* rootCommand({
          node: "/opt/t3/ozone",
          entry: "/opt/t3/ozone",
          executable: true,
          args,
        }),
      ).toBe("sudo /opt/t3/ozone browser setup --base-dir '/srv/ozone home'");
    }).pipe(Effect.scoped),
  );

  it.effect("names this install's launcher when ozone is not on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, ".local bin", "ozone");
      yield* fs.makeDirectory(path.dirname(shim), { recursive: true });
      yield* fs.writeFileString(shim, "#!/bin/sh\n", { mode: 0o755 });
      const desktop = {
        node: "/tmp/.mount_T3abc/t3code",
        entry: "/tmp/.mount_T3abc/resources/app.asar/apps/server/dist/bin.mjs",
        env: { T3CODE_CLI_PATH: shim },
      };

      expect(yield* rootCommand(desktop)).toBe(`sudo '${shim}' browser setup`);

      // An unrelated `ozone` on PATH, such as an older npm global, is another install's CLI.
      expect(yield* rootCommand({ ...desktop, path: yield* pathWithT3 })).toBe(
        `sudo '${shim}' browser setup`,
      );

      // The link the app installs onto PATH leads to its own launcher, so plain `ozone` is right.
      const linked = yield* fs.makeTempDirectoryScoped();
      yield* fs.symlink(shim, path.join(linked, "ozone"));
      expect(yield* rootCommand({ ...desktop, path: linked })).toBe(
        'sudo env "PATH=$PATH" ozone browser setup',
      );

      expect(
        yield* rootCommand({
          node: "/opt/t3/ozone",
          entry: "/opt/t3/ozone",
          executable: true,
        }),
      ).toBe("sudo /opt/t3/ozone browser setup");

      expect(
        yield* rootCommand({ ...desktop, env: { T3CODE_CLI_PATH: path.join(home, "gone") } }),
      ).toBe('sudo env "PATH=$PATH" ozone browser setup');
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("host CLI commands", (it) => {
  it.effect("renders a PowerShell command line on Windows", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, "ozone.cmd");
      yield* fs.writeFileString(shim, "@echo off\r\n");
      const hostCommand = (platform: NodeJS.Platform, env: Record<string, string>) =>
        resolveHostCliCommand("doctor", ["--base-dir", "C:\\Users\\Jane Doe\\.ozone"]).pipe(
          Effect.provideService(HostProcess.ExecutablePath, "C:\\Program Files\\Ozone\\ozone.exe"),
          Effect.provideService(HostProcess.Arguments, [
            "C:\\Program Files\\Ozone\\ozone.exe",
            "C:\\Program Files\\Ozone\\resources\\app.asar\\apps\\server\\dist\\bin.mjs",
          ]),
          Effect.provideService(HostProcess.IsExecutable, false),
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Environment, { PATH: "", ...env }),
        );
      expect((yield* hostCommand("win32", { T3CODE_CLI_PATH: shim })).command).toBe(
        `& "${shim}" doctor "--base-dir" "C:\\Users\\Jane Doe\\.ozone"`,
      );
      expect((yield* hostCommand("win32", {})).command).toBe(
        'ozone doctor "--base-dir" "C:\\Users\\Jane Doe\\.ozone"',
      );
      expect(
        (yield* resolveHostCliCommand("doctor", ["--base-dir", "C:\\T3\\\u201CArchive\u201D"]).pipe(
          Effect.provideService(HostProcess.Platform, "win32"),
          Effect.provideService(HostProcess.Environment, { PATH: "" }),
          Effect.provideService(HostProcess.ExecutablePath, "C:\\ozone.exe"),
          Effect.provideService(HostProcess.Arguments, ["C:\\ozone.exe", "C:\\bin.mjs"]),
          Effect.provideService(HostProcess.IsExecutable, false),
        )).command,
      ).toBe('ozone doctor "--base-dir" "C:\\T3\\\u201C\u201CArchive\u201D\u201D"');
      expect((yield* hostCommand("linux", { T3CODE_CLI_PATH: shim })).command).toMatch(
        / doctor --base-dir 'C:\\Users\\Jane Doe\\\.ozone'$/,
      );
    }).pipe(Effect.scoped),
  );
});
