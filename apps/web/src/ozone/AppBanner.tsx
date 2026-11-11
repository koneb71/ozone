import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  PreviewTabId,
  type OzoneApp,
  type OzoneRuntimeAction,
  type OzoneRuntimeStatus,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { BoxIcon, HammerIcon, MonitorIcon, PlayIcon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { previewRuntimeFor } from "~/browser/previewRuntime";
import type { ComposerBannerVariant } from "~/components/chat/ComposerBanner";
import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { openPreviewSession } from "~/components/preview/openPreviewSession";
import { dispatchPreviewAction } from "~/components/preview/previewActionBus";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { readThreadPreviewState } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useQuietThreadShell } from "~/state/entities";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { AppMenu } from "./AppMenu";
import { buildBannerItem } from "./BuildCard";
import { useBuildStagedIn } from "./homeFiles";
import { previewTabsShowing } from "./preview.logic";
import { ozoneEnvironment } from "./state";

/** Threads whose preview Ozone has opened by itself, so closing it stays the user's decision. */
const openedPreviews = new Set<string>();
/** How far each thread's build had come when this window last looked. */
const buildProgressSeen = new Map<string, string>();

/** Where the preview shows the app: the server's own browser sees it as the server does. */
const previewUrlOf = (target: ScopedThreadRef, appUrl: string) =>
  previewRuntimeFor(target.environmentId) === "server"
    ? appUrl
    : resolveDiscoveredServerUrl(target.environmentId, appUrl);

const reportFailure = (title: string, error: unknown) => {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : undefined,
    }),
  );
};

interface BannerCopy {
  readonly variant: ComposerBannerVariant;
  readonly title: string;
  readonly description: string | undefined;
}

function bannerCopy(app: OzoneApp, status: OzoneRuntimeStatus | null): BannerCopy {
  const where = `localhost:${app.port}`;
  switch (status?.phase) {
    case undefined:
      return { variant: "default", title: app.name, description: where };
    case "running":
      return { variant: "default", title: `${app.name} is running`, description: where };
    case "starting":
      return {
        variant: "info",
        title: `Starting ${app.name}`,
        description: status.message ?? undefined,
      };
    case "stopped":
      return { variant: "default", title: `${app.name} is stopped`, description: where };
    case "unhealthy":
      return {
        variant: "warning",
        title: `${app.name} is not answering`,
        description: status.message ?? undefined,
      };
    case "failed":
      return {
        variant: "error",
        title: `${app.name} did not start`,
        description: status.message ?? undefined,
      };
    case "unavailable":
      return {
        variant: "warning",
        title: "Docker is not running",
        description: status.message ?? undefined,
      };
  }
}

/**
 * The status of the Ozone app a thread belongs to, with its controls, as one composer notice.
 * Returns nothing for projects Ozone did not create.
 */
export function useAppBanners(
  threadRef: ScopedThreadRef | null,
  projectId: ProjectId | null,
): ReadonlyArray<ComposerBannerStackItem> {
  const environmentId = threadRef?.environmentId ?? null;
  const apps = useEnvironmentQuery(
    environmentId === null ? null : ozoneEnvironment.apps({ environmentId, input: {} }),
  );
  const app =
    projectId === null ? undefined : apps.data?.apps.find((entry) => entry.projectId === projectId);
  const statusQuery = useEnvironmentQuery(
    environmentId === null || app === undefined
      ? null
      : ozoneEnvironment.runtimeStatus({ environmentId, input: { projectId: app.projectId } }),
  );
  const runAction = useAtomCommand(ozoneEnvironment.runtimeAct, { reportFailure: false });
  const sentThread = useQuietThreadShell(threadRef);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const adjustPreview = useAtomCommand(previewEnvironment.adjust, { reportFailure: false });
  const build = useEnvironmentQuery(
    threadRef === null || app === undefined
      ? null
      : ozoneEnvironment.buildStatus({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        }),
  );
  const previews = useEnvironmentQuery(
    threadRef === null || app === undefined
      ? null
      : previewEnvironment.list({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        }),
  );
  const status = statusQuery.data;
  const url = status?.url ?? null;
  // Null until the server has answered: a thread that already has a preview tab keeps it.
  const hasPreview = previews.data === null ? null : previews.data.sessions.length > 0;

  const showPreview = async (target: ScopedThreadRef, appUrl: string) => {
    const result = await openPreviewSession({
      openPreview,
      threadRef: target,
      url: previewUrlOf(target, appUrl),
    });
    if (result._tag === "Success") {
      useRightPanelStore.getState().openBrowser(target, result.value.tabId);
    }
    return result;
  };

  const openPreviewOnce = useEffectEvent((target: ScopedThreadRef, appUrl: string) => {
    const key = scopedThreadKey(target);
    if (openedPreviews.has(key)) return;
    openedPreviews.add(key);
    void showPreview(target, appUrl);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the preview pane once, when the app's containers first report healthy
  useEffect(() => {
    if (threadRef !== null && url !== null && hasPreview === false) openPreviewOnce(threadRef, url);
  }, [threadRef, url, hasPreview]);

  // A page that failed while a worker was mid-edit has no live reload in it and would stay on
  // screen after the fix, so a task that passes reloads the tabs that show the app.
  const reloadPreview = useEffectEvent((target: ScopedThreadRef, appUrl: string) => {
    const showing = previewTabsShowing(
      readThreadPreviewState(target),
      previewUrlOf(target, appUrl),
    );
    for (const tab of showing) {
      if (tab.through === "visible-preview") {
        dispatchPreviewAction("refresh");
        continue;
      }
      void adjustPreview({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, tabId: PreviewTabId.make(tab.tabId), hardReload: true },
      });
    }
  });
  const tasksPassed = build.data?.build?.tasks.filter((task) => task.status === "done").length;
  const buildProgress =
    tasksPassed === undefined ? null : `${tasksPassed}:${build.data?.status ?? ""}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reloads the preview pane, which is outside React, when the build passes a task or completes
  useEffect(() => {
    if (threadRef === null || url === null || buildProgress === null) return;
    const key = scopedThreadKey(threadRef);
    const seen = buildProgressSeen.get(key);
    buildProgressSeen.set(key, buildProgress);
    // The first look at a thread is its state, not a change.
    if (seen !== undefined && seen !== buildProgress) reloadPreview(threadRef, url);
  }, [threadRef, url, buildProgress]);

  // A build request that came from Home with files waits in the composer until it is sent.
  const awaitsSend = useBuildStagedIn(threadRef) && sentThread === null;

  if (threadRef === null || app === undefined) return [];

  const act = async (action: OzoneRuntimeAction) => {
    const result = await runAction({
      environmentId: threadRef.environmentId,
      input: { projectId: app.projectId, action },
    });
    if (result._tag === "Failure") {
      reportFailure(
        `Could not ${action === "up" ? "start" : action} ${app.name}`,
        squashAtomCommandFailure(result),
      );
    }
  };
  const preview = async () => {
    if (url === null) return;
    const result = await showPreview(threadRef, url);
    if (result._tag === "Failure") {
      reportFailure("Could not open the preview", squashAtomCommandFailure(result));
    }
  };

  const copy = bannerCopy(app, status);
  const phase = status?.phase;
  const busy = phase === "starting";
  const buildItem = buildBannerItem(build.data);
  return [
    ...(awaitsSend
      ? [
          {
            id: "ozone-build-staged",
            variant: "info" as const,
            group: "attention" as const,
            icon: <HammerIcon />,
            title: "Ready to build",
            description: "Check the attachments, then send to start the build.",
          },
        ]
      : []),
    ...(buildItem === null ? [] : [buildItem]),
    {
      id: "ozone-app",
      variant: copy.variant,
      group: "environment",
      icon: busy ? <Spinner /> : <BoxIcon />,
      title: copy.title,
      ...(copy.description === undefined ? {} : { description: copy.description }),
      actions: (
        <>
          {phase === "running" ? (
            <Button size="xs" variant="ghost" onClick={() => void preview()}>
              <MonitorIcon />
              Preview
            </Button>
          ) : null}
          {phase === "stopped" || phase === "failed" ? (
            <Button size="xs" variant="ghost" onClick={() => void act("up")}>
              <PlayIcon />
              {phase === "failed" ? "Try again" : "Start"}
            </Button>
          ) : null}
          <AppMenu
            app={app}
            environmentId={threadRef.environmentId}
            phase={phase}
            onAct={(action) => void act(action)}
          />
        </>
      ),
    },
  ];
}
