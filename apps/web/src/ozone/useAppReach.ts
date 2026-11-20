import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { sharesEnvironmentLoopback } from "~/browser/browserTargetResolver";
import { usePreparedConnection } from "~/state/session";

/**
 * Whether this client is on the machine that runs the apps. An app and a deployment to that
 * machine answer only on its `localhost`, so a client elsewhere cannot open them.
 */
export function useAppReach(environmentId: EnvironmentId | null) {
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const sharesMachine = sharesEnvironmentLoopback(connection);
  return {
    sharesMachine,
    /** The name of the apps' machine, for a client that is not on it. */
    machine: sharesMachine ? null : (connection?.target.label ?? null),
  };
}
