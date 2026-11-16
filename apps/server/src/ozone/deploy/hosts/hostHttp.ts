import { OzoneAppError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { failed } from "../../errors.ts";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** How long a host gets to build and start a commit. */
const RELEASE_TIMEOUT = Duration.minutes(25);

export interface HostCall {
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Bytes sent as they are, for a host that takes file uploads. */
  readonly bytes?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  /** What the call does, for "Railway could not <what>". */
  readonly what: string;
}

/** The answer of a failed call, for a driver that reads more into it than the status. */
export interface HostRefusal {
  readonly status: number;
  readonly body: unknown;
}

/**
 * JSON calls to one host's API, with its token. A failed call becomes a sentence naming the host
 * and what it was asked to do; `explain` can replace it with one a person can act on.
 */
export const hostHttp = (options: {
  readonly http: HttpClient.HttpClient;
  readonly label: string;
  readonly baseUrl: string;
  readonly tokenHelp: string;
  /** What the host said went wrong, read from its error body. */
  readonly said: (body: unknown) => string | null;
  readonly explain?: (refusal: HostRefusal, call: HostCall) => string | null;
}) =>
  Effect.fn("hostHttp.call")(function* (token: string, call: HostCall) {
    const base = HttpClientRequest.make(call.method)(`${options.baseUrl}${call.path}`).pipe(
      HttpClientRequest.setUrlParams(call.query ?? {}),
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders(call.headers ?? {}),
    );
    const request =
      call.bytes !== undefined
        ? HttpClientRequest.bodyUint8Array(base, call.bytes, "application/octet-stream")
        : call.body === undefined
          ? base
          : HttpClientRequest.bodyJsonUnsafe(base, call.body);
    const response = yield* options.http.execute(request).pipe(
      Effect.timeout(Duration.seconds(60)),
      Effect.mapError(() =>
        failed(`Ozone could not reach ${options.label}. Check this computer's connection.`),
      ),
    );
    const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
    const body: unknown =
      text === "" ? null : yield* decodeJson(text).pipe(Effect.orElseSucceed(() => text));
    if (response.status >= 200 && response.status < 300) return body;
    if (response.status === 401) {
      return yield* failed(`${options.label} refused the token. ${options.tokenHelp}`);
    }
    const refusal = { status: response.status, body };
    return yield* failed(
      options.explain?.(refusal, call) ??
        `${options.label} could not ${call.what}: ${options.said(body) ?? `it answered ${response.status}`}.`,
    );
  });

/** Reads an answer as `schema`, or says the host answered in a way Ozone does not know. */
export const reading =
  <S extends Schema.Top>(schema: S, label: string, what: string) =>
  (body: unknown) =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => failed(`${label} answered ${what} in a way Ozone does not know.`)),
    );

/**
 * Asks again every few seconds until `settled` picks an answer. None: the host did not get there
 * in time.
 */
export const untilSettled = <A, B>(
  ask: Effect.Effect<A, OzoneAppError>,
  settled: (answer: A) => B | null,
  timeout: Duration.Duration = RELEASE_TIMEOUT,
) =>
  ask.pipe(
    Effect.flatMap((answer) => {
      const picked = settled(answer);
      return picked === null ? Effect.fail("waiting" as const) : Effect.succeed(picked);
    }),
    Effect.retry({
      schedule: Schedule.spaced(Duration.seconds(4)),
      while: (error) => error === "waiting",
    }),
    Effect.timeoutOption(timeout),
    Effect.mapError((error) => (error === "waiting" ? failed("The host did not answer.") : error)),
  );
