import { OzoneAppError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { failed } from "../errors.ts";

/** Where a Dokploy instance answers, and the key it takes. */
export interface DokployAccess {
  readonly url: string;
  readonly apiKey: string;
}

/**
 * Dokploy's API: `/api/<router>.<procedure>`, queries as GET with each field a query parameter,
 * mutations as POST with a JSON body, and the key in `x-api-key`.
 */
export class Dokploy extends Context.Service<
  Dokploy,
  {
    /** Fails, in words a person can act on, unless the key works there. */
    readonly verify: (access: DokployAccess) => Effect.Effect<void, OzoneAppError>;
    readonly query: (
      access: DokployAccess,
      procedure: string,
      input?: Readonly<Record<string, string>>,
    ) => Effect.Effect<unknown, OzoneAppError>;
    readonly mutate: (
      access: DokployAccess,
      procedure: string,
      input: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<unknown, OzoneAppError>;
  }
>()("t3/ozone/deploy/Dokploy") {}

const ErrorBody = Schema.Struct({ message: Schema.optionalKey(Schema.String) });
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** What Dokploy's answer to a failed call means for a person. */
const dokployProblem = (status: number, body: unknown, procedure: string, url: string): string => {
  const said = decodeErrorBody(body).pipe((option) =>
    option._tag === "Some" ? (option.value.message ?? null) : null,
  );
  if (status === 401 && (said === null || said === "Unauthorized")) {
    return `Dokploy at ${url} refused the API key. Make one under Settings → Profile → API/CLI, in the organization that should run the apps.`;
  }
  return `Dokploy could not ${procedure}: ${said ?? `it answered ${status}`}.`;
};

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  const send = Effect.fn("Dokploy.send")(function* (
    access: DokployAccess,
    procedure: string,
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const response = yield* http
      .execute(
        request.pipe(
          HttpClientRequest.setHeader("x-api-key", access.apiKey),
          HttpClientRequest.acceptJson,
        ),
      )
      .pipe(
        Effect.timeout(Duration.seconds(30)),
        Effect.mapError(() =>
          failed(`Ozone could not reach Dokploy at ${access.url}. Check the address.`),
        ),
      );
    const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
    const body: unknown =
      text === "" ? null : yield* decodeJson(text).pipe(Effect.orElseSucceed(() => null));
    if (response.status >= 200 && response.status < 300) return body;
    return yield* failed(dokployProblem(response.status, body, procedure, access.url));
  });

  const query = (
    access: DokployAccess,
    procedure: string,
    input: Readonly<Record<string, string>> = {},
  ) =>
    send(
      access,
      procedure,
      HttpClientRequest.get(`${access.url}/api/${procedure}`).pipe(
        HttpClientRequest.setUrlParams(input),
      ),
    );

  return Dokploy.of({
    verify: Effect.fn("Dokploy.verify")(function* (access) {
      const user = yield* query(access, "user.get");
      if (user === null || typeof user !== "object") {
        return yield* failed(
          `${access.url} did not answer like Dokploy. Check the address: it is the one you open Dokploy at.`,
        );
      }
    }),
    query,
    mutate: Effect.fn("Dokploy.mutate")((access, procedure, input) =>
      send(
        access,
        procedure,
        HttpClientRequest.post(`${access.url}/api/${procedure}`).pipe(
          HttpClientRequest.bodyJsonUnsafe(input),
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(Dokploy, make);
