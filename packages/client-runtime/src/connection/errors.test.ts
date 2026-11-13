import { describe, expect, it } from "@effect/vitest";

import { mapRemoteEnvironmentError } from "./errors.ts";
import { RemoteEnvironmentAuthFetchError, RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";

describe("mapRemoteEnvironmentError", () => {
  it.each([
    {
      error: new RemoteEnvironmentAuthFetchError({
        message: "Failed to fetch remote environment endpoint.",
        cause: new TypeError("Failed to fetch"),
      }),
      reason: "network",
    },
    {
      error: new RemoteEnvironmentAuthTimeoutError({
        requestUrl: "https://environment.example.test",
        timeoutMs: 10_000,
      }),
      reason: "timeout",
    },
  ])("retries when the endpoint cannot be reached: $error._tag", ({ error, reason }) => {
    expect(mapRemoteEnvironmentError(error)).toMatchObject({
      _tag: "ConnectionTransientError",
      reason,
      detail: error.message,
      hop: "server",
    });
  });
});
