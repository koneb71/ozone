import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NpmRelease from "../cloud/npmRelease.ts";

/**
 * Ozone is not upstream's `t3` npm package. Offering that package's releases would update an
 * Ozone server into T3 Code, so the lookup always reports that nothing is published.
 */
export const layerNoUpstreamReleases = Layer.succeed(
  NpmRelease.NpmRelease,
  NpmRelease.NpmRelease.of({
    get: Effect.fn("OzoneUpstreamReleases.get")(() => Effect.succeed(null)),
  }),
);
