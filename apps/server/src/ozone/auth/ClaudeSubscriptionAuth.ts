import {
  ProviderSetupError,
  type ProviderAuthMethod,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const CLAUDE_SUBSCRIPTION_METHOD_ID = "claude-subscription";

/** Variables that make Claude Code bill an API key instead of using the signed-in subscription. */
const CLAUDE_API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

const TERMINAL_OUTPUT_LIMIT = 16_384;

const SUBSCRIPTION_METHOD: ProviderAuthMethod = {
  id: CLAUDE_SUBSCRIPTION_METHOD_ID,
  name: "Claude subscription",
  description: "Sign in with your Claude plan. No API key is needed.",
  type: "terminal",
};

/**
 * How to get Claude Code onto the machine, in Anthropic's own words for its installer
 * (https://code.claude.com/docs/en/setup). Said when sign-in cannot find the `claude` command.
 */
const claudeInstallHelp = (platform: NodeJS.Platform) =>
  `Claude Code is not installed on this machine. Install it by running ${
    platform === "win32"
      ? "`irm https://claude.ai/install.ps1 | iex` in PowerShell"
      : "`curl -fsSL https://claude.ai/install.sh | bash` in a terminal"
  }, then sign in again. Its setup guide is at https://code.claude.com/docs/en/setup.`;

const AuthStatus = Schema.Struct({ loggedIn: Schema.Boolean });
const decodeAuthStatus = Schema.decodeUnknownOption(Schema.fromJsonString(AuthStatus));

/** Marks a Claude snapshot as one the app can sign in to. */
export const advertiseClaudeSignIn = <Snapshot extends ServerProvider>(
  snapshot: Snapshot,
): Snapshot => ({
  ...snapshot,
  setup: { canInstall: false, ...snapshot.setup, canAuthenticate: true },
});

/** Drops ambient API-key variables so the subscription sign-in is what Claude uses. */
export const withoutAmbientClaudeApiKey = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const scrubbed = { ...environment };
  for (const name of CLAUDE_API_KEY_VARIABLES) delete scrubbed[name];
  return scrubbed;
};

export interface ClaudeSubscriptionAuthOptions {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  /** Instances that share a Claude config directory share one sign-in. */
  readonly configDir: string;
  readonly onChanged: Effect.Effect<void>;
}

/**
 * Signs in to a Claude subscription by running Claude Code's own `auth login --claudeai` in a
 * pseudo-terminal. The credential stays with Claude Code; Ozone never sees or stores it.
 */
export const makeClaudeSubscriptionAuth = Effect.fn("makeClaudeSubscriptionAuth")(function* (
  options: ClaudeSubscriptionAuthOptions,
) {
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;

  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });

  const claude = (args: ReadonlyArray<string>) =>
    ChildProcess.make(options.binaryPath, [...args], {
      cwd: options.cwd,
      env: options.environment,
      stdin: "ignore",
      stderr: "ignore",
    });

  const signedIn = spawner.string(claude(["auth", "status", "--json"])).pipe(
    Effect.map((output) =>
      Option.match(decodeAuthStatus(output.trim()), {
        onNone: () => false,
        onSome: (status) => status.loggedIn,
      }),
    ),
    Effect.orElseSucceed(() => false),
  );

  const runLogin = Effect.fnUntraced(function* (context: ProviderAuthFlow.ProviderAuthFlowContext) {
    if (Option.isNone(pty)) {
      return yield* failure(
        "start",
        "This environment cannot open a sign-in terminal. Run `claude auth login` on its machine.",
      );
    }
    const exited = yield* Deferred.make<number>();
    const output = yield* Queue.sliding<string>(64);
    const process = yield* pty.value
      .spawn({
        shell: options.binaryPath,
        args: ["auth", "login", "--claudeai"],
        cwd: options.cwd,
        cols: 80,
        rows: 24,
        env: options.environment,
      })
      .pipe(Effect.mapError(() => failure("start", claudeInstallHelp(platform))));
    const detachData = process.onData((data) => {
      Queue.offerUnsafe(output, data.slice(-TERMINAL_OUTPUT_LIMIT));
    });
    const detachExit = process.onExit(({ exitCode }) => {
      Deferred.doneUnsafe(exited, Effect.succeed(exitCode));
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        detachData();
        detachExit();
        try {
          process.kill();
        } catch {
          // The login command already exited.
        }
      }),
    );
    let transcript = "";
    let outputOffset = 0;
    const publish = () =>
      context.setInteraction(
        { type: "terminal", id: "terminal", output: transcript, outputOffset },
        (response) =>
          response.type === "terminal"
            ? Effect.try({
                try: () => {
                  if (response.size) process.resize(response.size.cols, response.size.rows);
                  if (response.data) process.write(response.data);
                },
                catch: () => failure("respond", "The sign-in terminal is no longer available."),
              })
            : Effect.void,
      );
    yield* publish();
    yield* Queue.take(output).pipe(
      Effect.flatMap((data) => {
        outputOffset += data.length;
        transcript = (transcript + data).slice(-TERMINAL_OUTPUT_LIMIT);
        return publish();
      }),
      Effect.forever,
      Effect.forkScoped,
    );
    if ((yield* Deferred.await(exited)) !== 0) {
      return yield* failure("start", "Claude sign-in did not finish. Start sign-in again.");
    }
  });

  const authenticate = Effect.fn("ClaudeSubscriptionAuth.authenticate")(function* (
    _methodId: string,
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    yield* runLogin(context).pipe(Effect.scoped);
    yield* context.verifying;
    if (!(yield* signedIn)) {
      return yield* failure("verify", "Claude Code is still signed out. Start sign-in again.");
    }
    yield* options.onChanged;
  });

  const logout = Effect.gen(function* () {
    const exitCode = yield* spawner
      .exitCode(claude(["auth", "logout"]))
      .pipe(Effect.mapError(() => failure("logout", "Could not run `claude auth logout`.")));
    if (exitCode !== 0) return yield* failure("logout", "Claude Code could not sign out.");
    yield* options.onChanged;
  }).pipe(
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () => Effect.fail(failure("logout", "Claude Code did not finish signing out.")),
    }),
  );

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: `claude:${options.configDir}` },
    methods: Effect.succeed([SUBSCRIPTION_METHOD]),
    defaultMethodId: CLAUDE_SUBSCRIPTION_METHOD_ID,
    authenticate,
    logout,
  });
});
