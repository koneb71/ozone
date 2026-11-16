import { OzoneAppError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { failed } from "../errors.ts";

/**
 * How Ozone signs in to servers. It runs ssh with a settings file of its own that adds Ozone's
 * key and reads the person's `~/.ssh/config` after it, so a server reached with the person's keys
 * still works. Docker reaches `ssh://` hosts by running `ssh` from PATH, so Docker gets a PATH whose
 * first `ssh` passes that file too.
 */
export class SshAccess extends Context.Service<
  SshAccess,
  {
    /** `-F <file>` and the options every connection uses, before the destination. */
    readonly sshOptions: Effect.Effect<ReadonlyArray<string>>;
    /** What Docker needs in its environment to reach a server the way `sshOptions` does. */
    readonly dockerEnv: Effect.Effect<Readonly<Record<string, string>>>;
    /** Ozone's public key, made the first time. */
    readonly publicKey: Effect.Effect<string, OzoneAppError>;
    /**
     * Runs `script` on `host`, accepting the host's key the first time it is seen. Only adding a
     * server does this: it is the moment a person names the host.
     */
    readonly firstContact: (
      host: string,
      script: string,
    ) => Effect.Effect<SshOutput, OzoneAppError>;
    /** Signs in with a password once and runs `script`; the password is never written down. */
    readonly withPassword: (
      host: string,
      password: string,
      script: string,
    ) => Effect.Effect<SshOutput, OzoneAppError>;
  }
>()("t3/ozone/deploy/SshAccess") {}

export interface SshOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const quoted = (value: string) => `"${value.replaceAll('"', "")}"`;
const shellQuoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** The settings file. The person's own settings come after Ozone's, so theirs still apply. */
export const sshConfigText = (input: {
  readonly keyFile: string;
  readonly knownHostsFile: string;
}): string =>
  [
    "# Written by Ozone each time it starts. Ozone's ssh reads this file instead of",
    "# ~/.ssh/config, and reads that file below, so ssh still behaves as it does for you.",
    "Host *",
    `  IdentityFile ${quoted(input.keyFile)}`,
    // Naming a key drops ssh's defaults, so they are named too.
    "  IdentityFile ~/.ssh/id_ed25519",
    "  IdentityFile ~/.ssh/id_ecdsa",
    "  IdentityFile ~/.ssh/id_rsa",
    // A host key Ozone accepted goes to the first file; the person's own are read too.
    `  UserKnownHostsFile ${quoted(input.knownHostsFile)} ~/.ssh/known_hosts`,
    "Match all",
    "Include ~/.ssh/config",
    "Include /etc/ssh/ssh_config",
    "",
  ].join("\n");

/** Lets `publicKey` in, once, keeping the file's other keys. */
export const installKeyScript = (publicKey: string): string =>
  [
    "set -e",
    "umask 077",
    'mkdir -p "$HOME/.ssh"',
    'touch "$HOME/.ssh/authorized_keys"',
    `grep -qxF ${shellQuoted(publicKey)} "$HOME/.ssh/authorized_keys" || printf '%s\\n' ${shellQuoted(publicKey)} >> "$HOME/.ssh/authorized_keys"`,
    'chmod 700 "$HOME/.ssh"',
    'chmod 600 "$HOME/.ssh/authorized_keys"',
  ].join("\n");

/** Takes `publicKey` out, keeping the file's other keys and its permissions. */
export const removeKeyScript = (publicKey: string): string =>
  [
    "set -e",
    'file="$HOME/.ssh/authorized_keys"',
    '[ -f "$file" ] || exit 0',
    `grep -vxF ${shellQuoted(publicKey)} "$file" > "$file.ozone" || true`,
    'cat "$file.ozone" > "$file"',
    'rm -f "$file.ozone"',
  ].join("\n");

/** What a person pastes on the server to let Ozone's key in. */
export const installCommand = (publicKey: string): string =>
  `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${shellQuoted(publicKey)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;

/** `user@host:2222` as ssh takes it: the port is a flag of its own. */
export const destinationArgs = (host: string): ReadonlyArray<string> => {
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(host);
  const destination = match?.[1] ?? host;
  const port = match?.[2];
  return [...(port === undefined ? [] : ["-p", port]), destination];
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const windows = platform === "win32";
  const delimiter = windows ? ";" : ":";

  const directory = path.join(config.stateDir, "ozone", "ssh");
  const keyFile = path.join(directory, "id_ed25519");
  const knownHostsFile = path.join(directory, "known_hosts");
  const configFile = path.join(directory, "config");
  const binDirectory = path.join(directory, "bin");
  const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const searchPath = environment[pathKey] ?? "";

  /** The real ssh, found the way a shell finds it, never Ozone's own wrapper. */
  const realSsh = Effect.gen(function* () {
    const names = windows ? ["ssh.exe"] : ["ssh"];
    for (const entry of searchPath.split(delimiter)) {
      if (entry.length === 0 || path.resolve(entry) === binDirectory) continue;
      for (const name of names) {
        const candidate = path.join(entry, name);
        if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) return candidate;
      }
    }
    return null;
  });

  // Written once per start; a file that cannot be written leaves ssh as the person has it.
  const prepared = yield* Effect.cached(
    Effect.gen(function* () {
      yield* fs.makeDirectory(binDirectory, { recursive: true, mode: 0o700 });
      yield* fs.writeFileString(configFile, sshConfigText({ keyFile, knownHostsFile }), {
        mode: 0o600,
      });
      const ssh = yield* realSsh;
      if (ssh === null) return false;
      if (windows) {
        yield* fs.writeFileString(
          path.join(binDirectory, "ssh.cmd"),
          `@${quoted(ssh)} -F ${quoted(configFile)} -o BatchMode=yes %*\r\n`,
        );
      } else {
        const wrapper = path.join(binDirectory, "ssh");
        yield* fs.writeFileString(
          wrapper,
          `#!/bin/sh\nexec ${shellQuoted(ssh)} -F ${shellQuoted(configFile)} -o BatchMode=yes "$@"\n`,
          { mode: 0o700 },
        );
        yield* fs.chmod(wrapper, 0o700);
      }
      return true;
    }).pipe(
      Effect.orElseSucceed(() => false),
      Effect.withSpan("SshAccess.prepare"),
    ),
  );

  const sshOptions = prepared.pipe(
    Effect.map((ready) => (ready ? ["-F", configFile] : [])),
    Effect.map((options) => [...options, "-o", "ConnectTimeout=15"]),
  );

  const run = Effect.fn("SshAccess.run")(function* (input: {
    readonly host: string;
    readonly options: ReadonlyArray<string>;
    readonly script: string;
    readonly env?: Readonly<Record<string, string>>;
  }) {
    const output = yield* runner
      .run({
        command: "ssh",
        args: [...(yield* sshOptions), ...input.options, ...destinationArgs(input.host), "sh -s"],
        stdin: input.script,
        ...(input.env === undefined ? {} : { env: { ...input.env } }),
        timeout: Duration.minutes(1),
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.mapError(() => failed("Ozone could not run ssh. Install an OpenSSH client.")));
    return {
      code: output.timedOut || output.code === null ? null : Number(output.code),
      stdout: output.stdout,
      stderr: output.stderr,
    };
  });

  const publicKey = Effect.gen(function* () {
    yield* prepared;
    const exists = yield* fs.exists(`${keyFile}.pub`).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      const made = yield* runner
        .run({
          command: "ssh-keygen",
          args: ["-q", "-t", "ed25519", "-N", "", "-C", "ozone", "-f", keyFile],
          timeout: Duration.seconds(30),
          timeoutBehavior: "timedOutResult",
        })
        .pipe(
          Effect.mapError(() =>
            failed("Ozone could not run ssh-keygen. Install an OpenSSH client."),
          ),
        );
      if (made.code !== 0 || made.timedOut) {
        return yield* failed(`Ozone could not make its SSH key.\n${made.stderr.trim()}`);
      }
    }
    return yield* fs.readFileString(`${keyFile}.pub`).pipe(
      Effect.map((text) => text.trim()),
      Effect.mapError(() => failed("Ozone could not read its SSH key.")),
    );
  }).pipe(Effect.withSpan("SshAccess.publicKey"));

  return SshAccess.of({
    sshOptions,
    dockerEnv: prepared.pipe(
      Effect.map((ready) =>
        ready ? { [pathKey]: `${binDirectory}${delimiter}${searchPath}` } : {},
      ),
    ),
    publicKey,
    firstContact: Effect.fn("SshAccess.firstContact")((host, script) =>
      run({
        host,
        options: ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"],
        script,
      }),
    ),
    withPassword: Effect.fn("SshAccess.withPassword")(function* (host, password, script) {
      if (windows) {
        return yield* failed(
          "Signing in with a password needs macOS or Linux. Paste Ozone's key on the server instead.",
        );
      }
      // ssh reads a password only from a terminal or from this program, never from stdin.
      const askpass = path.join(
        yield* fs
          .makeTempDirectoryScoped({ prefix: "ozone-askpass-" })
          .pipe(Effect.mapError(() => failed("Ozone could not prepare the sign-in."))),
        "askpass",
      );
      yield* fs
        .writeFileString(askpass, `#!/bin/sh\nprintf '%s\\n' "$OZONE_SSH_PASSWORD"\n`, {
          mode: 0o700,
        })
        .pipe(
          Effect.andThen(fs.chmod(askpass, 0o700)),
          Effect.mapError(() => failed("Ozone could not prepare the sign-in.")),
        );
      return yield* run({
        host,
        options: [
          "-o",
          "BatchMode=no",
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "PubkeyAuthentication=no",
          "-o",
          "PreferredAuthentications=keyboard-interactive,password",
          "-o",
          "NumberOfPasswordPrompts=1",
        ],
        script,
        env: {
          SSH_ASKPASS: askpass,
          SSH_ASKPASS_REQUIRE: "force",
          DISPLAY: environment["DISPLAY"] ?? "ozone",
          OZONE_SSH_PASSWORD: password,
        },
      });
    }, Effect.scoped),
  });
});

export const layer = Layer.effect(SshAccess, make).pipe(Layer.provide(ProcessRunner.layer));
