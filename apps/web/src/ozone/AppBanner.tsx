import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  OzoneApp,
  OzoneRuntimeAction,
  OzoneRuntimeStatus,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  BoxIcon,
  EllipsisIcon,
  HammerIcon,
  MonitorIcon,
  PlayIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { previewRuntimeFor } from "~/browser/previewRuntime";
import type { ComposerBannerVariant } from "~/components/chat/ComposerBanner";
import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { openPreviewSession } from "~/components/preview/openPreviewSession";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { AppLogsDialog } from "./AppLogsDialog";
import { ozoneEnvironment } from "./state";

/** Threads whose preview Ozone has opened by itself, so closing it stays the user's decision. */
const openedPreviews = new Set<string>();

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
export function useOzoneComposerBanners(
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
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [logsOpen, setLogsOpen] = useState(false);
  const status = statusQuery.data;
  const url = status?.url ?? null;

  const showPreview = async (target: ScopedThreadRef, appUrl: string) => {
    const result = await openPreviewSession({
      openPreview,
      threadRef: target,
      url:
        previewRuntimeFor(target.environmentId) === "server"
          ? appUrl
          : resolveDiscoveredServerUrl(target.environmentId, appUrl),
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
    if (threadRef !== null && url !== null) openPreviewOnce(threadRef, url);
  }, [threadRef, url]);

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
  return [
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
          <Menu>
            <MenuTrigger
              aria-label={`Manage ${app.name}`}
              render={<Button size="icon-xs" variant="ghost" />}
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                disabled={phase !== "running" && phase !== "unhealthy"}
                onClick={() => void act("restart")}
              >
                <RotateCwIcon />
                Restart
              </MenuItem>
              <MenuItem disabled={phase === "unavailable"} onClick={() => void act("rebuild")}>
                <HammerIcon />
                Rebuild
              </MenuItem>
              <MenuItem
                disabled={phase === "stopped" || phase === "unavailable" || phase === undefined}
                onClick={() => void act("stop")}
              >
                <SquareIcon />
                Stop
              </MenuItem>
              <MenuItem onClick={() => setLogsOpen(true)}>
                <ScrollTextIcon />
                Logs
              </MenuItem>
            </MenuPopup>
          </Menu>
          <AppLogsDialog
            app={app}
            environmentId={threadRef.environmentId}
            open={logsOpen}
            onOpenChange={setLogsOpen}
          />
        </>
      ),
    },
  ];
}
