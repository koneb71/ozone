// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_APPLE_TEAM_ID=ROOT123456\nT3CODE_FEATURE_SECRETS=root\nONLY_ROOT=root\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_APPLE_TEAM_ID=LOCAL12345\nT3CODE_FEATURE_SECRETS=local\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toEqual({
      T3CODE_APPLE_TEAM_ID: "LOCAL12345",
      T3CODE_FEATURE_SECRETS: "local",
      ONLY_ROOT: "root",
    });
    expect(loadRepoEnv({ baseEnv: { T3CODE_APPLE_TEAM_ID: "CI12345678" }, repoRoot })).toEqual({
      T3CODE_APPLE_TEAM_ID: "CI12345678",
      T3CODE_FEATURE_SECRETS: "local",
      ONLY_ROOT: "root",
    });
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
