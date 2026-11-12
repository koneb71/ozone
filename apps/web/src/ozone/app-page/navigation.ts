import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import type { AppSection } from "../appPage.logic";

/** Opens an app's page at a section, over whatever is on screen, as Settings opens. */
export function useOpenAppPage() {
  const navigate = useNavigate();
  return (environmentId: EnvironmentId, projectId: ProjectId, section: AppSection = "overview") =>
    navigate({
      to: "/apps/$environmentId/$projectId/$section",
      params: { environmentId, projectId, section },
    });
}
