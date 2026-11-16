import { createOzoneEnvironmentAtoms } from "@t3tools/client-runtime/state/ozone";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";

import { connectionAtomRuntime } from "../connection/runtime";

export const ozoneEnvironment = createOzoneEnvironmentAtoms(connectionAtomRuntime);

export const appsQuery = (environmentId: EnvironmentId) =>
  ozoneEnvironment.apps({ environmentId, input: {} });

export const refreshApps = (environmentId: EnvironmentId) =>
  appAtomRegistry.refresh(appsQuery(environmentId));

/** The app a project is, or null for a project Ozone did not create. */
export function useApp(environmentId: EnvironmentId | null, projectId: ProjectId | null) {
  const apps = useEnvironmentQuery(environmentId === null ? null : appsQuery(environmentId));
  const app =
    projectId === null
      ? null
      : (apps.data?.apps.find((entry) => entry.projectId === projectId) ?? null);
  return { app, loaded: apps.data !== null };
}
