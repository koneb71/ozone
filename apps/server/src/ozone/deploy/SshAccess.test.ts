import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../../processRunner.ts";
import * as SshAccess from "./SshAccess.ts";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOzone ozone";
const OTHER = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther someone@laptop";

it("reads the person's own ssh settings after adding Ozone's key", () => {
  const text = SshAccess.sshConfigText({
    keyFile: "/state/ozone/ssh/id_ed25519",
    knownHostsFile: "/state/ozone/ssh/known_hosts",
  });
  const lines = text.split("\n");
  assert.isTrue(lines.indexOf('  IdentityFile "/state/ozone/ssh/id_ed25519"') > 0);
  // `Match all` ends the `Host *` block, so the Include applies to every host.
  assert.isTrue(lines.indexOf("Match all") < lines.indexOf("Include ~/.ssh/config"));
  assert.include(text, "~/.ssh/id_ed25519");
});

it.live("installs Ozone's key once, and removes only that key", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runner = yield* ProcessRunner.ProcessRunner;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-ssh-home-" });
    const authorized = path.join(home, ".ssh", "authorized_keys");
    const sh = (script: string) =>
      runner.run({ command: "sh", args: ["-s"], stdin: script, env: { HOME: home } });

    yield* fs.makeDirectory(path.join(home, ".ssh"));
    yield* fs.writeFileString(authorized, `${OTHER}\n`);
    yield* sh(SshAccess.installKeyScript(KEY));
    yield* sh(SshAccess.installKeyScript(KEY));
    assert.strictEqual(yield* fs.readFileString(authorized), `${OTHER}\n${KEY}\n`);
    assert.strictEqual((yield* fs.stat(authorized)).mode & 0o777, 0o600);

    yield* sh(SshAccess.removeKeyScript(KEY));
    assert.strictEqual(yield* fs.readFileString(authorized), `${OTHER}\n`);
    // The last key going leaves an empty file, not a failure.
    yield* sh(SshAccess.removeKeyScript(OTHER));
    assert.strictEqual(yield* fs.readFileString(authorized), "");
  }).pipe(
    Effect.scoped,
    Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  ),
);

it("passes a port as ssh's flag", () => {
  assert.deepStrictEqual(SshAccess.destinationArgs("root@example.com:2222"), [
    "-p",
    "2222",
    "root@example.com",
  ]);
  assert.deepStrictEqual(SshAccess.destinationArgs("root@example.com"), ["root@example.com"]);
});
