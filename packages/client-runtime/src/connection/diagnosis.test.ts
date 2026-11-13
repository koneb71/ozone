import { describe, expect, it } from "@effect/vitest";

import { presentConnectionDiagnosis } from "./diagnosis.ts";
import { credentialMissingError, mapRemoteEnvironmentError } from "./errors.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  type ConnectionAttemptError,
  type SupervisorConnectionState,
} from "./model.ts";
import { RemoteEnvironmentAuthFetchError } from "../rpc/http.ts";

const backoff = (lastFailure: ConnectionAttemptError): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "backoff",
  attempt: 3,
  lastFailure,
  retryAt: Date.UTC(2026, 9, 19, 12, 0, 30),
});

const unreachable = mapRemoteEnvironmentError(
  new RemoteEnvironmentAuthFetchError({ message: "Failed to fetch", cause: new TypeError() }),
);

const diagnose = (state: SupervisorConnectionState) =>
  presentConnectionDiagnosis({ hostLabel: "Mac mini", state });

const results = (state: SupervisorConnectionState) =>
  diagnose(state)?.hops.map((hop) => `${hop.hop}:${hop.result}`);

describe("presentConnectionDiagnosis", () => {
  it("reports nothing while no attempt has failed", () => {
    expect(diagnose(AVAILABLE_CONNECTION_STATE)).toBeNull();
  });

  it("names the host when its server does not answer", () => {
    const diagnosis = diagnose(backoff(unreachable));
    expect(diagnosis?.headline).toBe("T3 Code on Mac mini did not answer");
    expect(results(backoff(unreachable))).toEqual(["device:ok", "server:failed"]);
    expect(diagnosis?.facts).toContainEqual(["Cause", "network"]);
    expect(diagnosis?.facts).toContainEqual(["Attempts", "3"]);
  });

  it("stops at this device when it could not prepare the connection", () => {
    const state = backoff(credentialMissingError("connection-1"));
    expect(diagnose(state)?.headline).toBe("This device could not prepare the connection");
    expect(results(state)).toEqual(["device:failed", "server:unchecked"]);
  });

  it("reports this device as offline before any other hop", () => {
    const state = { ...backoff(unreachable), network: "offline" as const };
    expect(diagnose(state)?.headline).toBe("This device is offline");
    expect(results(state)?.[0]).toBe("device:failed");
  });

  it("asks for an update when the host runs an older server", () => {
    const failure = new ConnectionBlockedError({
      reason: "unsupported",
      detail: "Mac mini must be updated.",
      serverUpdateRequired: true,
    });
    const diagnosis = diagnose(backoff(failure));
    expect(diagnosis?.headline).toBe("Mac mini runs an older T3 Code");
    expect(diagnosis?.steps).toEqual(["Update T3 Code on Mac mini."]);
  });

  it("does not report hops as working when the failure names none", () => {
    const failure = new ConnectionBlockedError({
      reason: "authentication",
      detail: "The environment credential is invalid.",
    });
    expect(results(backoff(failure))).not.toContainEqual(expect.stringMatching(/:ok$/));
  });
});
