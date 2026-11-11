import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../../processRunner.ts";

export interface DockerRunInput {
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly timeout?: Duration.Input;
  readonly maxOutputBytes?: number;
  /** Set only by the user-confirmed "Delete app data" flow. */
  readonly allowDataRemoval?: true;
}

export interface DockerRunOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class DockerUnavailableError extends Schema.TaggedError<DockerUnavailableError>()(
  "DockerUnavailableError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * The one place Ozone talks to Docker. Keeping it a single method lets tests script Docker, and
 * lets `removesData` guard every command Ozone can issue.
 */
export class DockerCli extends Context.Service<
  DockerCli,
  {
    readonly run: (input: DockerRunInput) => Effect.Effect<DockerRunOutput, DockerUnavailableError>;
  }
>()("t3/ozone/runtime/DockerCli") {}

const DEFAULT_TIMEOUT = Duration.minutes(2);
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

const DOCKER_OPTIONS_WITH_VALUE = new Set([
  "--config",
  "-c",
  "--context",
  "-H",
  "--host",
  "-l",
  "--log-level",
  "--tlscacert",
  "--tlscert",
  "--tlskey",
]);
const COMPOSE_OPTIONS_WITH_VALUE = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--project-directory",
  "--env-file",
  "--profile",
  "--ansi",
  "--progress",
  "--parallel",
]);

/** The first word that is not an option or an option's value, and everything after it. */
const subcommandOf = (args: ReadonlyArray<string>, optionsWithValue: ReadonlySet<string>) => {
  let index = 0;
  while (index < args.length && args[index]?.startsWith("-")) {
    index += optionsWithValue.has(args[index] ?? "") ? 2 : 1;
  }
  return { name: args[index], rest: args.slice(index + 1) };
};

/** `--volumes`, or `v` inside a cluster of short flags such as `-fsv`. */
const asksForVolumes = (args: ReadonlyArray<string>) =>
  args.some((arg) => arg === "--volumes" || /^-[a-zA-Z]*v[a-zA-Z]*$/.test(arg));

/**
 * True for the Docker commands that delete volumes. App data lives in volumes, so these are the
 * only commands that can lose it. A command run inside a container by `exec` is not Docker's own.
 */
export const removesData = (args: ReadonlyArray<string>): boolean => {
  const command = subcommandOf(args, DOCKER_OPTIONS_WITH_VALUE);
  const action = command.rest[0];
  if (command.name === "volume")
    return action === "rm" || action === "remove" || action === "prune";
  if (command.name === "system") return action === "prune" && asksForVolumes(command.rest);
  if (command.name !== "compose") return false;
  const compose = subcommandOf(command.rest, COMPOSE_OPTIONS_WITH_VALUE);
  return (compose.name === "down" || compose.name === "rm") && asksForVolumes(compose.rest);
};

export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  return DockerCli.of({
    run: Effect.fn("DockerCli.run")(function* (input) {
      if (removesData(input.args) && input.allowDataRemoval !== true) {
        return yield* Effect.die(
          new Error(`Ozone refused a Docker command that removes data: ${input.args.join(" ")}`),
        );
      }
      const output = yield* runner
        .run({
          command: "docker",
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          stdin: input.stdin,
          timeout: input.timeout ?? DEFAULT_TIMEOUT,
          maxOutputBytes: input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
          timeoutBehavior: "timedOutResult",
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new DockerUnavailableError({
                detail:
                  error._tag === "ProcessSpawnError"
                    ? "Docker is not installed on this machine."
                    : "Docker did not answer.",
              }),
          ),
        );
      return {
        code: output.code === null ? null : Number(output.code),
        stdout: output.stdout,
        stderr: output.stderr,
        timedOut: output.timedOut,
      };
    }),
  });
});

export const layer = Layer.effect(DockerCli, make).pipe(Layer.provide(ProcessRunner.layer));
