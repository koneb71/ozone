import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";

import { SettingsPageContainer } from "~/components/settings/settingsLayout";

import { VariablesSection } from "../ui/VariablesSection";

/** Settings and secrets the app reads from its environment, kept outside its code. */
export function EnvironmentSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  return (
    <SettingsPageContainer>
      <VariablesSection
        environmentId={props.environmentId}
        scope={{ kind: "app", projectId: props.app.projectId }}
      />
    </SettingsPageContainer>
  );
}
