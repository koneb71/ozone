import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";

import { useEnvironmentQuery } from "~/state/query";

import { useAppBanners } from "./AppBanner";
import { useHomeFilesDelivery } from "./homeFiles";
import { ozoneEnvironment } from "./state";

/**
 * What Ozone adds to a thread's composer: the files Home handed over, and the notices of the app
 * the thread belongs to. The thread view calls this once.
 */
export function useOzoneComposer(
  threadRef: ScopedThreadRef | null,
  projectId: ProjectId | null,
): ReadonlyArray<ComposerBannerStackItem> {
  useHomeFilesDelivery(threadRef);
  return useAppBanners(threadRef, projectId);
}

/** Whether the thread belongs to an app whose owner wants a plan before every change. */
export function useAppPlansFirst(
  threadRef: ScopedThreadRef | null,
  projectId: ProjectId | null,
): boolean {
  const environmentId = threadRef?.environmentId ?? null;
  const apps = useEnvironmentQuery(
    environmentId === null ? null : ozoneEnvironment.apps({ environmentId, input: {} }),
  );
  return (
    projectId !== null &&
    apps.data?.apps.find((app) => app.projectId === projectId)?.settings.reviewPlans === true
  );
}
