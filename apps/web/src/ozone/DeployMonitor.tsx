import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneServerReport } from "@t3tools/contracts";
import { RefreshCwIcon, ServerIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { formatBytes } from "~/lib/formatBytes";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "./state";

const REFRESH_MS = 5_000;
const bytes = (value: number | null) => (value === null ? "–" : formatBytes(value));

/** How production is doing: each container's use, its logs, and the machine it runs on. */
export function DeployMonitor(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly host: string | null;
}) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const metrics = useEnvironmentQuery(ozoneEnvironment.deployMetrics(target));
  const services = [
    ...new Set((metrics.data?.containers ?? []).map((container) => container.service)),
  ].filter((service) => service !== "migrate");
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls production's containers while this pane is open
  useEffect(() => {
    const timer = window.setInterval(refreshMetrics, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshMetrics]);

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Containers" className="flex flex-col gap-2">
        {metrics.error !== null ? (
          <p className="text-muted-foreground text-sm">{metrics.error}</p>
        ) : metrics.data === null ? (
          <Spinner className="size-4" />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Service</th>
                <th className="py-1 font-normal">CPU</th>
                <th className="py-1 font-normal">Memory</th>
                <th className="py-1 font-normal">Network in / out</th>
              </tr>
            </thead>
            <tbody>
              {metrics.data.containers.map((container) => (
                <tr key={`${container.service}-${container.state}-${container.memoryBytes}`}>
                  <td className="py-1">
                    <span className="flex items-center gap-1.5">
                      {container.service}
                      <Badge
                        variant={
                          container.state !== "running"
                            ? "outline"
                            : container.health === "unhealthy"
                              ? "warning"
                              : "success"
                        }
                      >
                        {container.state === "running"
                          ? (container.health ?? "running")
                          : container.state}
                      </Badge>
                    </span>
                  </td>
                  <td className="py-1 tabular-nums">
                    {container.cpuPercent === null ? "–" : `${container.cpuPercent.toFixed(1)}%`}
                  </td>
                  <td className="py-1 tabular-nums">
                    {bytes(container.memoryBytes)}
                    {container.memoryLimitBytes === null
                      ? ""
                      : ` of ${bytes(container.memoryLimitBytes)}`}
                  </td>
                  <td className="py-1 tabular-nums">
                    {bytes(container.networkInBytes)} / {bytes(container.networkOutBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Logs" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
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
          <Button
            aria-label="Refresh the logs"
            size="icon-xs"
            variant="ghost"
            onClick={logs.refresh}
          >
            <RefreshCwIcon />
          </Button>
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2 font-mono text-2xs leading-4">
          {logs.error ?? logs.data?.text ?? "Loading…"}
        </pre>
      </section>

      <ServerCheck environmentId={props.environmentId} host={props.host} />
    </div>
  );
}

/** What the machine production runs on has, and whether Docker and the proxy are ready there. */
export function ServerCheck(props: {
  readonly environmentId: EnvironmentId;
  readonly host: string | null;
}) {
  const check = useAtomCommand(ozoneEnvironment.checkServer, { reportFailure: false });
  const setup = useAtomCommand(ozoneEnvironment.setupServer, { reportFailure: false });
  const [report, setReport] = useState<OzoneServerReport | null>(null);
  const [working, setWorking] = useState<"check" | "setup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const place = props.host === null ? "this machine" : props.host.replace(/^[^@]*@/, "");

  const run = async (action: "check" | "setup", installDocker = false) => {
    if (action === "setup" && installDocker) {
      const confirmed = await ensureLocalApi()
        .dialogs.confirm(
          `Install Docker on ${place}? Ozone runs Docker's official install script there over SSH. It needs root, or sudo without a password.`,
        )
        .catch(() => false);
      if (!confirmed) return;
    }
    setWorking(action);
    setError(null);
    const result =
      action === "check"
        ? await check({ environmentId: props.environmentId, input: { host: props.host } })
        : await setup({
            environmentId: props.environmentId,
            input: { host: props.host, ...(installDocker ? { installDocker } : {}) },
          });
    setWorking(null);
    if (result._tag === "Success") setReport(result.value);
    else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "That did not work.");
    }
  };

  return (
    <section
      aria-label="Server"
      className="flex flex-col gap-2 rounded-xl border border-border/70 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          <ServerIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          {place}
        </span>
        <div className="flex gap-1.5">
          <Button
            disabled={working !== null}
            size="xs"
            variant="outline"
            onClick={() => void run("check")}
          >
            {working === "check" ? <Spinner /> : null}
            Check
          </Button>
          <Button
            disabled={working !== null}
            size="xs"
            variant="outline"
            onClick={() => void run("setup")}
          >
            {working === "setup" ? <Spinner /> : null}
            Set up
          </Button>
        </div>
      </div>
      {error === null ? null : (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {report === null ? (
        <p className="text-muted-foreground text-xs">
          Set up makes sure Docker answers there and starts Ozone's proxy, which serves apps with a
          domain over HTTPS.
        </p>
      ) : report.problem !== null ? (
        <Alert variant="warning">
          <AlertDescription>
            <p className="whitespace-pre-wrap">{report.problem}</p>
            {report.canInstallDocker ? (
              <Button
                disabled={working !== null}
                size="sm"
                variant="outline"
                onClick={() => void run("setup", true)}
              >
                Install Docker
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">System</dt>
          <dd>{report.os ?? "–"}</dd>
          <dt className="text-muted-foreground">Docker</dt>
          <dd>
            {report.docker ?? "–"}
            {report.compose === null ? "" : `, Compose ${report.compose}`}
          </dd>
          <dt className="text-muted-foreground">Size</dt>
          <dd>
            {report.cpus ?? "–"} CPUs, {bytes(report.memoryBytes)} memory
          </dd>
          <dt className="text-muted-foreground">Disk</dt>
          <dd>
            {report.diskFreeBytes === null
              ? "–"
              : `${bytes(report.diskFreeBytes)} free of ${bytes(report.diskTotalBytes)}`}
          </dd>
          <dt className="text-muted-foreground">Proxy</dt>
          <dd>
            {report.proxy === "running"
              ? "Running"
              : report.proxy === "stopped"
                ? "Stopped"
                : "Not set up"}
          </dd>
        </dl>
      )}
    </section>
  );
}
