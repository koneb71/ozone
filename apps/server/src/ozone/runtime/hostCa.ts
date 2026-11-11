import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

/**
 * The certificate bundle this machine trusts beyond the public roots, if it has one: behind a
 * TLS-intercepting proxy, containers and image builds need it to reach package registries.
 */
export const hostCaPath = Effect.fn("hostCaPath")(function* (
  environment: NodeJS.ProcessEnv,
  fs: FileSystem.FileSystem,
) {
  const candidate = environment.NODE_EXTRA_CA_CERTS ?? environment.SSL_CERT_FILE;
  if (candidate === undefined || candidate.trim().length === 0) return null;
  const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
  return exists ? candidate : null;
});
