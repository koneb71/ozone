import type { OzoneApp, ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";

import { useAppBanners } from "./AppBanner";
import { useHomeFilesDelivery } from "./homeFiles";
import { useApp } from "./state";

/**
 * What Ozone adds to a thread's composer: the files Home handed over, and the app the thread
 * belongs to with its notices. The thread view calls this once.
 */
export function useOzoneComposer(
  threadRef: ScopedThreadRef | null,
  projectId: ProjectId | null,
): { readonly banners: ReadonlyArray<ComposerBannerStackItem>; readonly app: OzoneApp | null } {
  useHomeFilesDelivery(threadRef);
  const { app } = useApp(threadRef?.environmentId ?? null, projectId);
  return { banners: useAppBanners(threadRef, app), app };
}
