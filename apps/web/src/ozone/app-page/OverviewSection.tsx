import { buildHeadline } from "@t3tools/client-runtime/state/ozone";
import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { metaLine, phaseTone } from "../appPage.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { OutputView } from "../ui/OutputView";
import { StatusDot } from "../ui/StatusDot";
import { useOpenAppThread } from "../useOpenAppThread";
import { useOpenAppPage } from "./navigation";
import { useAppRuntime } from "./useAppRuntime";

const TEMPLATE_LABEL: Record<string, string> = {
  "web-app": "Web app",
  "landing-page": "Landing page",
  "api-service": "API",
};

/** Where the app stands: its containers, its latest build, its production. */
export function OverviewSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  const { app, environmentId } = props;
  const runtime = useAppRuntime(app, environmentId);
  const thread = useOpenAppThread(environmentId);
  const openPage = useOpenAppPage();
  const latest = thread.latestOf(app);
  const build =
    useEnvironmentQuery(
      latest === null
        ? null
        : ozoneEnvironment.buildStatus({ environmentId, input: { threadId: latest.id } }),
    ).data ?? null;
  const headline = buildHeadline(build);
  const deploy =
    useEnvironmentQuery(
      ozoneEnvironment.deployStatus({ environmentId, input: { projectId: app.projectId } }),
    ).data ?? null;
  const [confirmMigration, setConfirmMigration] = useState(false);
  const migration = runtime.status?.migration ?? null;

  return (
    <SettingsPageContainer>
      {migration === null ? null : (
        <Alert variant="warning">
          <AlertTitle>A migration waits for you</AlertTitle>
          <AlertDescription>
            <p>It can lose data, so it has not run.</p>
            <OutputView text={migration} label="Held-back statements" />
            <Button
              disabled={runtime.working !== null}
              size="sm"
              variant="outline"
              onClick={() => setConfirmMigration(true)}
            >
              {runtime.working === "migrate" ? <Spinner /> : null}
              Apply after a snapshot
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <SettingsSection title="App">
        <SettingsRow
          title="Status"
          description={runtime.status?.message ?? undefined}
          control={
            <span className="flex items-center gap-2 text-sm">
              <StatusDot {...runtime.dot} />
              {runtime.label}
            </span>
          }
        />
        <SettingsRow
          title="Address"
          description="Where the app answers on the computer that runs it."
          control={<span className="font-mono text-sm">localhost:{app.port}</span>}
        />
        <SettingsRow
          title="Template"
          control={
            <span className="text-sm">{TEMPLATE_LABEL[app.templateId] ?? app.templateId}</span>
          }
        />
        <SettingsRow
          title="Created"
          control={<span className="text-sm">{formatRelativeTimeLabel(app.createdAt)}</span>}
        />
      </SettingsSection>

      <SettingsSection title="Build">
        <SettingsRow
          title={headline?.title ?? (latest === null ? "No thread yet" : "No build yet")}
          description={
            headline?.detail ??
            (latest === null
              ? "Open a thread and describe what to build."
              : "Ask in the thread for a change and the build plans it.")
          }
          control={
            <Button size="xs" variant="outline" onClick={() => thread.open(app)}>
              {latest === null ? "New thread" : "Open thread"}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="Production">
        {deploy === null || deploy.target === null ? (
          <SettingsRow
            title="Not deployed"
            description="Run the production build on this computer or on a server."
            control={
              <Button
                size="xs"
                variant="outline"
                onClick={() => void openPage(environmentId, app.projectId, "deploy")}
              >
                Deploy
              </Button>
            }
          />
        ) : (
          <>
            <SettingsRow
              title="Status"
              description={deploy.state === "failed" ? (deploy.message ?? undefined) : undefined}
              control={
                <span className="flex items-center gap-2 text-sm">
                  <StatusDot
                    {...(deploy.state === "running"
                      ? phaseTone("running")
                      : deploy.state === "deploying"
                        ? phaseTone("starting")
                        : deploy.state === "failed"
                          ? phaseTone("failed")
                          : phaseTone("stopped"))}
                  />
                  {deploy.state === "running"
                    ? "Running"
                    : deploy.state === "deploying"
                      ? "Deploying"
                      : deploy.state === "failed"
                        ? "Last deploy failed"
                        : "Stopped"}
                </span>
              }
            />
            {deploy.url === null ? null : (
              <SettingsRow
                title="Address"
                control={
                  <Button
                    render={<a href={deploy.url} rel="noreferrer" target="_blank" />}
                    size="xs"
                    variant="ghost"
                  >
                    <span className="font-mono">{deploy.url.replace(/^https?:\/\//, "")}</span>
                    <ExternalLinkIcon />
                  </Button>
                }
              />
            )}
            <SettingsRow
              title="Deployed"
              description={metaLine([
                deploy.deployedAt === null ? null : formatRelativeTimeLabel(deploy.deployedAt),
                deploy.commitSha === null ? null : `commit ${deploy.commitSha.slice(0, 7)}`,
              ])}
              control={
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void openPage(environmentId, app.projectId, "deployments")}
                >
                  Deployments
                </Button>
              }
            />
          </>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={confirmMigration}
        onOpenChange={setConfirmMigration}
        title="Run the migration?"
        description="A snapshot of the data is taken first, so Data or History can bring it back."
        confirmLabel="Apply migration"
        destructive
        onConfirm={() => void runtime.act("migrate")}
      />
    </SettingsPageContainer>
  );
}
