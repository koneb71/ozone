import { createOzoneEnvironmentAtoms } from "@t3tools/client-runtime/state/ozone";

import { connectionAtomRuntime } from "../connection/runtime";

export const ozoneEnvironment = createOzoneEnvironmentAtoms(connectionAtomRuntime);
