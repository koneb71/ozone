import { OzoneAppError, type OzoneVersionCheck } from "@t3tools/contracts";
import { cliReleaseChannelOf } from "@t3tools/shared/cliRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";

import packageJson from "../../package.json" with { type: "json" };
import { resolveNewestVersion } from "../cli/update.ts";

/**
 * Whether a newer Ozone is published. It asks GitHub only when a person asks: the server never
 * looks by itself.
 */
export class OzoneRelease extends Context.Service<
  OzoneRelease,
  { readonly check: Effect.Effect<OzoneVersionCheck, OzoneAppError> }
>()("t3/ozone/OzoneRelease") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const environment = yield* HostProcess.Environment;
  const check = Effect.fn("OzoneRelease.check")(function* () {
    const current = packageJson.version;
    const latest = yield* resolveNewestVersion(cliReleaseChannelOf(current)).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(HostProcess.Environment, environment),
      Effect.mapError((error) => new OzoneAppError({ reason: "failed", message: error.message })),
    );
    return { current, latest, newer: compareSemverVersions(latest, current) > 0 };
  });
  return OzoneRelease.of({ check: check() });
});

export const layer = Layer.effect(OzoneRelease, make);
