import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  getNewProjectPublishTargets,
  getNewProjectRepository,
} from "@t3tools/client-runtime/operations/projects";
import type {
  EnvironmentId,
  OzoneSavedServer,
  ProjectId,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { GitBranchPlusIcon } from "lucide-react";
import { useState } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useProject } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { remoteNeedOf, type RemoteNeed } from "../deploy.logic";
import { useOzoneCommand } from "../ui/useOzoneCommand";

/**
 * Whether the app needs a Git remote before it can deploy to `server`, and the one step that
 * gives it one: a GitHub repository made through the same publish flow as the Git menu.
 */
export function useAppRemote(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  server: OzoneSavedServer | null,
) {
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const cwd = project?.workspaceRoot ?? null;
  const status = useEnvironmentQuery(
    cwd === null ? null : vcsEnvironment.status({ environmentId, input: { cwd } }),
  );
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const publishRepository = useAtomCommand(sourceControlEnvironment.publishRepository, {
    reportFailure: false,
  });
  const { working, run } = useOzoneCommand();

  const target =
    discovery.data === null
      ? null
      : (getNewProjectPublishTargets(discovery.data).find(
          (candidate) => candidate.definition.kind === "github",
        ) ?? null);
  const need = remoteNeedOf({
    server,
    hasRemote: status.data?.hasPrimaryRemote ?? null,
    signedIn: discovery.data === null ? null : target !== null,
    repository: target === null || cwd === null ? null : getNewProjectRepository(target, cwd),
  });

  const create = async (visibility: SourceControlRepositoryVisibility) => {
    if (need.kind !== "create" || cwd === null || target === null) return;
    const result = await run("remote", "Could not create the GitHub repository", () =>
      publishRepository({
        environmentId,
        input: {
          cwd,
          provider: target.definition.kind,
          repository: need.repository,
          visibility,
          // An address that names the repository plainly, for whatever clones it.
          protocol: "https",
        },
      }),
    );
    if (result._tag === "Success") status.refresh();
  };
  return { need, create, creating: working === "remote" };
}

/** The row that says the app is not on GitHub yet, with the button that puts it there. */
export function RemoteRow(props: {
  readonly need: RemoteNeed;
  readonly creating: boolean;
  readonly builder: string;
  readonly onCreate: (visibility: SourceControlRepositoryVisibility) => void;
}) {
  const { need } = props;
  const [visibility, setVisibility] = useState<SourceControlRepositoryVisibility>("private");
  if (need.kind === "none" || need.kind === "checking") return null;
  return (
    <SettingsRow
      title="This app is not on GitHub yet"
      description={
        need.kind === "create" ? (
          `${props.builder} builds the app from a Git repository. Ozone can create ${need.repository} and push the app to it.`
        ) : (
          <>
            {props.builder} builds the app from a Git repository. Sign in to GitHub under{" "}
            <Link className="underline underline-offset-2" to="/settings/source-control">
              Source control
            </Link>{" "}
            and Ozone can create one for it.
          </>
        )
      }
      control={
        need.kind === "create" ? (
          <div className="flex items-center gap-2">
            <ToggleGroup
              aria-label="Who can see the repository"
              disabled={props.creating}
              value={[visibility]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "private" || value === "public") setVisibility(value);
              }}
            >
              <Toggle value="private">Private</Toggle>
              <Toggle value="public">Public</Toggle>
            </ToggleGroup>
            <Button disabled={props.creating} size="xs" onClick={() => props.onCreate(visibility)}>
              {props.creating ? <Spinner /> : <GitBranchPlusIcon />}
              Create repository
            </Button>
          </div>
        ) : undefined
      }
    />
  );
}
