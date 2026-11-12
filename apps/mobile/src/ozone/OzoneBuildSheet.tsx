import { CRITERION_LABEL, taskStateLabel } from "@t3tools/client-runtime/state/ozone";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { ScreenContent } from "../components/ui/ScreenContent";
import { SheetHeader } from "../components/ui/SheetHeader";
import { useEnvironmentQuery } from "../state/query";
import { ozoneEnvironment } from "./state";

type BuildTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** The tasks of a thread's build and what each is doing, with what the browser test found. */
export function OzoneBuildSheet({ route }: StaticScreenProps<BuildTarget>) {
  const { environmentId, threadId } = route.params;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const build =
    useEnvironmentQuery(ozoneEnvironment.buildStatus({ environmentId, input: { threadId } })).data
      ?.build ?? null;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title="Build" onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-5 pb-6"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {build === null || build.tasks.length === 0 ? (
            <Text className="pt-6 text-center text-sm text-foreground-muted">No plan yet.</Text>
          ) : (
            build.tasks.map((task) => (
              <View key={task.id} className="gap-1 border-b border-border py-3">
                <View className="flex-row items-start gap-3">
                  <Text className="min-w-0 flex-1 text-base text-foreground">{task.title}</Text>
                  <Text className="text-sm text-foreground-muted">
                    {taskStateLabel(task, build)}
                  </Text>
                </View>
                {task.blockedReason ? (
                  <Text className="text-sm text-warning-foreground">{task.blockedReason}</Text>
                ) : null}
              </View>
            ))
          )}
          {build?.verification.results.map((result) => (
            <View key={result.criterion} className="gap-1 border-b border-border py-3">
              <View className="flex-row items-start gap-3">
                <Text className="min-w-0 flex-1 text-base text-foreground">{result.criterion}</Text>
                <Text className="text-sm text-foreground-muted">
                  {CRITERION_LABEL[result.verdict]}
                </Text>
              </View>
              {result.note ? (
                <Text className="text-sm text-foreground-muted">{result.note}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
