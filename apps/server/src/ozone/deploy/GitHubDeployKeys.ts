import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../../processRunner.ts";

const API = "https://api.github.com";

/**
 * What a builder outside this machine needs to clone a GitHub repository: nothing when anyone can
 * read it, a read-only deploy key when it is private. The key is added with the token the `gh`
 * command line holds, or one in the environment; Ozone keeps no GitHub token of its own.
 */
export class GitHubDeployKeys extends Context.Service<
  GitHubDeployKeys,
  {
    /** `unknown` when GitHub would not say, as when it limits anonymous requests. */
    readonly visibility: (repository: string) => Effect.Effect<"public" | "private" | "unknown">;
    /** Lets `publicKey` read the repository. False: no token, or GitHub refused it. */
    readonly add: (input: {
      readonly repository: string;
      readonly title: string;
      readonly publicKey: string;
    }) => Effect.Effect<boolean>;
  }
>()("t3/ozone/deploy/GitHubDeployKeys") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcess.Environment;

  const statusOf = (request: HttpClientRequest.HttpClientRequest) =>
    http
      .execute(
        request.pipe(
          HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
          HttpClientRequest.setHeader("user-agent", "ozone"),
        ),
      )
      .pipe(
        Effect.timeout(Duration.seconds(20)),
        Effect.map((response) => response.status),
        Effect.orElseSucceed(() => 0),
      );

  const token = Effect.gen(function* () {
    const fromEnvironment = environment["GH_TOKEN"] ?? environment["GITHUB_TOKEN"] ?? "";
    if (fromEnvironment.length > 0) return fromEnvironment;
    const output = yield* runner
      .run({
        command: "gh",
        args: ["auth", "token", "--hostname", "github.com"],
        timeout: Duration.seconds(15),
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 4 * 1024,
        outputMode: "truncate",
      })
      .pipe(Effect.option);
    return output._tag === "Some" && output.value.code === 0 ? output.value.stdout.trim() : "";
  });

  return GitHubDeployKeys.of({
    visibility: Effect.fn("GitHubDeployKeys.visibility")(function* (repository) {
      // Asked without a token: only a repository anyone can read answers.
      const status = yield* statusOf(HttpClientRequest.get(`${API}/repos/${repository}`));
      return status === 200 ? "public" : status === 404 ? "private" : "unknown";
    }),
    add: Effect.fn("GitHubDeployKeys.add")(function* (input) {
      const bearer = yield* token;
      if (bearer.length === 0) return false;
      const status = yield* statusOf(
        HttpClientRequest.post(`${API}/repos/${input.repository}/keys`).pipe(
          HttpClientRequest.bearerToken(bearer),
          HttpClientRequest.bodyJsonUnsafe({
            title: input.title,
            key: input.publicKey,
            read_only: true,
          }),
        ),
      );
      // 422: the key is on the repository already.
      return status === 201 || status === 422;
    }),
  });
});

export const layer = Layer.effect(GitHubDeployKeys, make).pipe(Layer.provide(ProcessRunner.layer));
