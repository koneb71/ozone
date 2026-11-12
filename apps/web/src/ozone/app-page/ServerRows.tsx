import type { EnvironmentId, OzoneServerReport } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { formatBytes } from "~/lib/formatBytes";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow } from "../ui/SectionRows";
import { StatusDot } from "../ui/StatusDot";
import { useOzoneCommand } from "../ui/useOzoneCommand";

const bytes = (value: number | null) => (value === null ? "Unknown" : formatBytes(value));

/** The machine production runs on: what it has, and whether Docker and the proxy are ready. */
export function ServerSection(props: {
  readonly environmentId: EnvironmentId;
  readonly host: string | null;
}) {
  const check = useAtomCommand(ozoneEnvironment.checkServer, { reportFailure: false });
  const setup = useAtomCommand(ozoneEnvironment.setupServer, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [report, setReport] = useState<OzoneServerReport | null>(null);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const place = props.host === null ? "this computer" : props.host.replace(/^[^@]*@/, "");

  const go = async (action: "check" | "setup", installDocker = false) => {
    const result =
      action === "check"
        ? await run("check", `Could not check ${place}`, () =>
            check({ environmentId: props.environmentId, input: { host: props.host } }),
          )
        : await run("setup", `Could not set up ${place}`, () =>
            setup({
              environmentId: props.environmentId,
              input: { host: props.host, ...(installDocker ? { installDocker } : {}) },
            }),
          );
    if (result._tag === "Success") setReport(result.value);
  };

  return (
    <SettingsSection
      title="Server"
      headerAction={
        <div className="flex items-center gap-1">
          <Button
            disabled={working !== null}
            size="xs"
            variant="ghost"
            onClick={() => void go("check")}
          >
            {working === "check" ? <Spinner /> : null}
            Check
          </Button>
          <Button
            disabled={working !== null}
            size="xs"
            variant="outline"
            onClick={() => void go("setup")}
          >
            {working === "setup" ? <Spinner /> : null}
            Set up
          </Button>
        </div>
      }
    >
      {report === null ? (
        <EmptyRow
          title={place.charAt(0).toUpperCase() + place.slice(1)}
          description="Set up makes sure Docker answers there and starts the proxy that serves domains."
        />
      ) : report.problem !== null ? (
        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              <StatusDot tone="warning" />
              {place.charAt(0).toUpperCase() + place.slice(1)} is not ready
            </span>
          }
          description={report.problem}
          control={
            report.canInstallDocker ? (
              <Button
                disabled={working !== null}
                size="xs"
                variant="outline"
                onClick={() => setConfirmInstall(true)}
              >
                Install Docker
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <SettingsRow title="System" control={<Value>{report.os ?? "Unknown"}</Value>} />
          <SettingsRow
            title="Docker"
            control={
              <Value>
                {report.docker ?? "Unknown"}
                {report.compose === null ? "" : `, Compose ${report.compose}`}
              </Value>
            }
          />
          <SettingsRow
            title="Size"
            control={
              <Value>
                {report.cpus ?? "?"} CPUs, {bytes(report.memoryBytes)} memory
              </Value>
            }
          />
          <SettingsRow
            title="Disk"
            control={
              <Value>
                {report.diskFreeBytes === null
                  ? "Unknown"
                  : `${bytes(report.diskFreeBytes)} free of ${bytes(report.diskTotalBytes)}`}
              </Value>
            }
          />
          <SettingsRow
            title="Proxy"
            description="Serves apps that have a domain, over HTTPS."
            control={
              <span className="flex items-center gap-2 text-sm">
                <StatusDot tone={report.proxy === "running" ? "success" : "idle"} />
                {report.proxy === "running"
                  ? "Running"
                  : report.proxy === "stopped"
                    ? "Stopped"
                    : "Not set up"}
              </span>
            }
          />
        </>
      )}
      <ConfirmDialog
        open={confirmInstall}
        onOpenChange={setConfirmInstall}
        title={`Install Docker on ${place}?`}
        description="Ozone runs Docker's official install script there over SSH. It needs root, or sudo without a password."
        confirmLabel="Install Docker"
        onConfirm={() => void go("setup", true)}
      />
    </SettingsSection>
  );
}

function Value(props: { readonly children: ReactNode }) {
  return <span className="text-end text-sm">{props.children}</span>;
}
