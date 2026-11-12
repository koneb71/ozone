import { useAtomValue } from "@effect/atom-react";
import { appNotice, buildHeadline } from "@t3tools/client-runtime/state/ozone";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ozoneAppUrl,
  type OzoneApp,
  type OzoneRuntimeAction,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { Keyboard, Pressable, View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import * as Dialog from "../components/ui/Dialog";
import { Menu } from "../components/ui/Menu";
import { cn } from "../lib/cn";
import { useEnvironmentServerConfig } from "../state/entities";
import { previewEnvironment, useThreadServerBrowserTabs } from "../state/preview";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { ozoneEnvironment } from "./state";

const TITLE_TONE = {
  default: "text-foreground",
  info: "text-foreground",
  success: "text-adaptive-emerald-700-300",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
} as const;

const reportFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  Dialog.alert(title, error instanceof Error ? error.message : String(error));
};

/**
 * The Ozone app a thread belongs to, above the composer: how it is running, its controls, and
 * where its build stands. Renders nothing for a project Ozone did not create.
 */
export function OzoneAppCard(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly projectId: ProjectId;
}) {
  const environmentId = props.threadRef?.environmentId ?? null;
  const apps = useEnvironmentQuery(
    environmentId === null ? null : ozoneEnvironment.apps({ environmentId, input: {} }),
  );
  const app = apps.data?.apps.find((entry) => entry.projectId === props.projectId);
  if (props.threadRef === null || app === undefined) return null;
  return <AppCard app={app} threadRef={props.threadRef} />;
}

function AppCard({
  app,
  threadRef,
}: {
  readonly app: OzoneApp;
  readonly threadRef: ScopedThreadRef;
}) {
  const { environmentId, threadId } = threadRef;
  const navigation = useNavigation();
  const status =
    useEnvironmentQuery(
      ozoneEnvironment.runtimeStatus({ environmentId, input: { projectId: app.projectId } }),
    ).data ?? null;
  const build =
    useEnvironmentQuery(ozoneEnvironment.buildStatus({ environmentId, input: { threadId } }))
      .data ?? null;
  const canAct = useAtomValue(ozoneEnvironment.runtimeAct.permissionAtom(environmentId));
  const canApprove = useAtomValue(ozoneEnvironment.approveBuild.permissionAtom(environmentId));
  const runAction = useAtomCommand(ozoneEnvironment.runtimeAct, { reportFailure: false });
  const approveBuild = useAtomCommand(ozoneEnvironment.approveBuild, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  // The phone shows the app through the browser the server runs, which sees it at localhost.
  const serverBrowser =
    useEnvironmentServerConfig(environmentId)?.environment.capabilities.serverBrowser === true;
  const browserTabs = useThreadServerBrowserTabs({
    environmentId,
    threadId,
    enabled: serverBrowser,
  });

  const act = async (action: OzoneRuntimeAction) => {
    const result = await runAction({ environmentId, input: { projectId: app.projectId, action } });
    const verb = action === "up" ? "start" : action === "migrate" ? "run the migration of" : action;
    reportFailure(`Could not ${verb} ${app.name}`, result);
  };
  // A migration that can lose data runs only when the person says so, after a snapshot.
  const applyMigration = (statements: string) => {
    Dialog.confirm({
      title: `Run the migration ${app.name} is holding back?`,
      message: `${statements}\n\nA snapshot of the data is taken first, so Data or History can bring it back.`,
      confirmText: "Apply",
      destructive: true,
      onConfirm: () => void act("migrate"),
    });
  };
  const showTab = (tabId: string) => {
    navigation.navigate("ThreadBrowserPreview", { environmentId, threadId, tabId });
  };
  const preview = async () => {
    Keyboard.dismiss();
    const url = ozoneAppUrl(app);
    const showing = browserTabs.tabs.find(
      (tab) =>
        tab.navStatus._tag !== "Idle" &&
        (tab.navStatus.url === url || tab.navStatus.url.startsWith(`${url}/`)),
    );
    if (showing !== undefined) {
      showTab(showing.tabId);
      return;
    }
    const result = await openPreview({
      environmentId,
      input: { threadId, url, runtime: "server" },
    });
    if (result._tag === "Success") showTab(result.value.tabId);
    else reportFailure("Could not open the preview", result);
  };
  const approve = async () => {
    reportFailure(
      "Could not start the build",
      await approveBuild({ environmentId, input: { threadId } }),
    );
  };

  const notice = appNotice(app, status);
  const headline = buildHeadline(build);
  const phase = status?.phase;
  return (
    <View className="mx-3 mb-2 gap-2 rounded-xl border border-border bg-screen p-3">
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className={cn("font-t3-bold text-sm", TITLE_TONE[notice.tone])} numberOfLines={1}>
            {notice.title}
          </Text>
          {notice.description ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={2}>
              {notice.description}
            </Text>
          ) : null}
        </View>
        {phase === "running" && serverBrowser ? (
          <Button label="Preview" size="compact" tone="secondary" onPress={() => void preview()} />
        ) : null}
        {phase === "stopped" || phase === "failed" ? (
          <Button
            label="Start"
            size="compact"
            tone="secondary"
            disabled={!canAct}
            onPress={() => void act("up")}
          />
        ) : null}
        <Menu
          actions={[
            {
              id: "restart",
              title: "Restart",
              attributes: { disabled: !canAct || (phase !== "running" && phase !== "unhealthy") },
            },
            {
              id: "rebuild",
              title: "Rebuild",
              attributes: { disabled: !canAct || phase === "unavailable" },
            },
            {
              id: "stop",
              title: "Stop",
              attributes: {
                disabled:
                  !canAct || phase === "stopped" || phase === "unavailable" || phase === undefined,
              },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            const action = nativeEvent.event;
            if (action === "restart" || action === "rebuild" || action === "stop") void act(action);
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Manage ${app.name}`}
            className="h-11 w-11 items-center justify-center"
          >
            <SymbolView
              name="ellipsis"
              size={18}
              tintColorClassName="accent-icon"
              type="monochrome"
            />
          </Pressable>
        </Menu>
      </View>
      {status?.migration ? (
        <View className="gap-2 border-t border-border-subtle pt-2">
          <Text className="font-t3-medium text-sm text-warning-foreground">
            A migration waits for you
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={3}>
            It can lose data, so it has not run. {status.migration}
          </Text>
          <View className="flex-row">
            <Button
              label="Apply after a snapshot"
              size="compact"
              tone="secondary"
              disabled={!canAct}
              onPress={() => applyMigration(status.migration ?? "")}
            />
          </View>
        </View>
      ) : null}
      {headline ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${headline.title}. Show the tasks`}
          onPress={() => {
            Keyboard.dismiss();
            navigation.navigate("OzoneBuild", { environmentId, threadId });
          }}
          className="gap-0.5 border-t border-border-subtle pt-2 active:opacity-70"
        >
          <Text className={cn("font-t3-medium text-sm", TITLE_TONE[headline.tone])}>
            {headline.title}
          </Text>
          {headline.detail ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={2}>
              {headline.detail}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      {build?.status === "review" ? (
        <Button label="Start building" disabled={!canApprove} onPress={() => void approve()} />
      ) : null}
    </View>
  );
}
