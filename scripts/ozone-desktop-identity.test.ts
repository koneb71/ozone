import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { createBuildConfig } from "./build-desktop-artifact.ts";
import {
  OZONE_DESKTOP_APP_ID,
  OZONE_LINUX_WM_CLASS,
  ozoneStagePackage,
} from "./ozone-desktop-identity.ts";

const staged = (platform: "mac" | "linux" | "win", target: string) =>
  createBuildConfig(platform, target, "0.1.0", false, false, undefined, undefined).pipe(
    Effect.map((build) =>
      ozoneStagePackage({
        name: "t3code",
        description: "T3 Code is an open-source desktop app for coding agents.",
        homepage: "https://t3.codes",
        author: "T3 Tools",
        build,
      }),
    ),
  );

// Upstream's build script writes T3 Code's names; an installed Ozone must carry none of them, or it
// shares an identity, and with it data, with an installed T3 Code.
it.layer(NodeServices.layer)("ozone desktop identity", (it) => {
  it.effect.each([
    ["mac", "dmg"],
    ["linux", "AppImage"],
    ["win", "nsis"],
  ] as const)("packages %s as Ozone and keeps upstream's URL schemes", ([platform, target]) =>
    Effect.gen(function* () {
      const stage = yield* staged(platform, target);
      const text = JSON.stringify(stage);
      assert.notMatch(text, /T3[ -]Code|com\.t3tools|t3\.codes|T3 Tools/);
      assert.include(stage, { name: "ozone", author: "Ozone" });
      assert.include(stage.build, {
        appId: OZONE_DESKTOP_APP_ID,
        productName: "Ozone (Beta)",
        artifactName: "Ozone-${version}-${arch}.${ext}",
      });
      // Links made for T3 Code still open: the schemes are never renamed.
      if (platform !== "win") assert.include(text, '"schemes":["t3code","t3code-dev"]');
    }),
  );

  it.effect("names the Linux launcher as the running app reports itself", () =>
    Effect.gen(function* () {
      const stage = yield* staged("linux", "AppImage");
      assert.nestedPropertyVal(stage.build, "linux.executableName", "ozone");
      assert.nestedPropertyVal(
        stage.build,
        "linux.desktop.entry.StartupWMClass",
        OZONE_LINUX_WM_CLASS,
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // The desktop app is another package; it sets this name on itself when it starts.
      const startup = yield* fs.readFileString(
        path.resolve(import.meta.dirname, "../apps/desktop/src/app/DesktopEarlyElectronStartup.ts"),
      );
      assert.include(startup, `"${OZONE_LINUX_WM_CLASS}.desktop"`);
      // The package installs Ozone's own AppStream file, which must exist.
      const [metainfo] = (stage.build.deb as { readonly fpm: ReadonlyArray<string> }).fpm;
      const source = metainfo?.split("=")[0] ?? "";
      assert.strictEqual(path.basename(source), `${OZONE_DESKTOP_APP_ID}.metainfo.xml`);
      assert.isTrue(yield* fs.exists(source));
    }),
  );
});
