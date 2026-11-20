import type { EnvironmentId, OzoneApp, OzoneContainerMetrics } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { formatBytes } from "~/lib/formatBytes";
import { useEnvironmentQuery } from "~/state/query";

import { ozoneEnvironment } from "../state";
import { OutputView } from "../ui/OutputView";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { ServerSection } from "./ServerRows";
import type { AppDeploy } from "./useAppDeploy";

const REFRESH_MS = 5_000;
const bytes = (value: number | null) => (value === null ? "–" : formatBytes(value));

const healthBadge = (container: OzoneContainerMetrics) =>
  container.state !== "running" ? (
    <Badge variant="outline">{container.state}</Badge>
  ) : container.health === "unhealthy" ? (
    <Badge variant="warning">Unhealthy</Badge>
  ) : container.health === "starting" ? (
    <Badge variant="info">Starting</Badge>
  ) : (
    <Badge variant="success">Healthy</Badge>
  );

/** How production is doing: each container's use, its logs, and the machine it runs on. */
export function MonitoringSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deploy: AppDeploy;
}) {
  const metrics = useEnvironmentQuery(
    ozoneEnvironment.deployMetrics({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId },
    }),
  );
  const deployedTo = props.deploy.status?.target ?? null;
  const host = deployedTo?.host ?? null;
  const containers = (metrics.data?.containers ?? []).filter(
    (container) => container.service !== "migrate",
  );
  const services = [...new Set(containers.map((container) => container.service))];
  const [service, setService] = useState<string | null>(null);
  const shown = service ?? services[0] ?? null;
  const logs = useEnvironmentQuery(
    shown === null
      ? null
      : ozoneEnvironment.deployLogs({
          environmentId: props.environmentId,
          input: { projectId: props.app.projectId, service: shown, tail: 200 },
        }),
  );
  const refreshMetrics = metrics.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls production's containers while this section is open
  useEffect(() => {
    const timer = window.setInterval(refreshMetrics, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshMetrics]);

  return (
    <SettingsPageContainer width="wide">
      <SettingsSection title="Containers">
        <SectionRows
          items={metrics.data === null ? null : containers}
          error={metrics.error}
          onRetry={metrics.refresh}
          loadingLabel="Loading containers"
          empty={
            <EmptyRow title="Nothing runs" description="Deploy the app to start its containers." />
          }
        >
          {(rows) => (
            <div className="px-3 py-2 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-end">CPU</TableHead>
                    <TableHead className="text-end">Memory</TableHead>
                    <TableHead className="text-end">Network in / out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((container) => (
                    <TableRow
                      key={`${container.service}-${container.memoryBytes}-${container.state}`}
                    >
                      <TableCell>
                        <span className="font-medium">{container.service}</span>
                      </TableCell>
                      <TableCell>{healthBadge(container)}</TableCell>
                      <TableCell className="text-end">
                        <span className="tabular-nums">
                          {container.cpuPercent === null
                            ? "–"
                            : `${container.cpuPercent.toFixed(1)}%`}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <span className="tabular-nums">
                          {bytes(container.memoryBytes)}
                          <span className="text-muted-foreground">
                            {container.memoryLimitBytes === null
                              ? ""
                              : ` / ${bytes(container.memoryLimitBytes)}`}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <span className="tabular-nums">
                          {bytes(container.networkInBytes)} / {bytes(container.networkOutBytes)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionRows>
      </SettingsSection>

      <SettingsSection
        title="Logs"
        variant="plain"
        headerAction={
          <div className="flex items-center gap-2">
            {services.length > 1 ? (
              <ToggleGroup
                aria-label="Whose logs"
                value={shown === null ? [] : [shown]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (typeof value === "string") setService(value);
                }}
              >
                {services.map((name) => (
                  <Toggle key={name} value={name}>
                    {name}
                  </Toggle>
                ))}
              </ToggleGroup>
            ) : null}
            <Button size="xs" variant="outline" onClick={logs.refresh}>
              <RefreshIcon refreshing={logs.isPending} />
              Refresh
            </Button>
          </div>
        }
      >
        <OutputView
          text={logs.error ?? logs.data?.text ?? null}
          placeholder={shown === null ? "No container to read." : "Loading logs"}
          size="tall"
          label="Production logs"
        />
      </SettingsSection>

      {deployedTo?.dokploy == null && deployedTo?.hosted == null ? (
        <ServerSection environmentId={props.environmentId} host={host} />
      ) : null}
    </SettingsPageContainer>
  );
}
