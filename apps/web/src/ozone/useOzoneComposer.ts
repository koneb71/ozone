import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";

import { useAppBanners } from "./AppBanner";
import { useHomeFilesDelivery } from "./homeFiles";

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
