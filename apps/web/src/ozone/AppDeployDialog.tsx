import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneDeployStatus } from "@t3tools/contracts";
import { ExternalLinkIcon, RocketIcon, ServerIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { DOMAIN, HOST } from "./deploy.logic";
import { DeployHistory } from "./DeployHistory";
import { DeployMonitor, ServerCheck } from "./DeployMonitor";
import { DeploySettings } from "./DeploySettings";
import { ozoneEnvironment } from "./state";

type Where = "here" | "server";
type Pane = "deploy" | "history" | "monitor" | "settings";

const URL_PATTERN = /^https?:\/\/\S+$/;

function statusLine(status: OzoneDeployStatus): string {
  // Held back before anything changed, so what was deployed before is still what runs.
  if (status.migration !== null && status.state === "failed") {
    return status.deployedAt === null
      ? "Not deployed yet."
      : `Still on the version deployed ${formatRelativeTimeLabel(status.deployedAt)}.`;
  }
  switch (status.state) {
    case "none":
      return "Not deployed yet.";
    case "deploying":
      return status.message ?? "Deploying.";
    case "running":
      return `Running${status.deployedAt === null ? "" : `, deployed ${formatRelativeTimeLabel(status.deployedAt)}`}.`;
    case "stopped":
      return "Stopped. Its data is kept for the next deploy.";
    case "failed":
      return "The last deploy failed.";
  }
}

/** Runs an app's production build where people can reach it, and stops it again. */
export function AppDeployDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        {props.open ? <AppDeploy app={props.app} environmentId={props.environmentId} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function AppDeploy(props: { readonly app: OzoneApp; readonly environmentId: EnvironmentId }) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const status = useEnvironmentQuery(ozoneEnvironment.deployStatus(target));
  const deploy = useAtomCommand(ozoneEnvironment.deploy, { reportFailure: false });
  const stopDeploy = useAtomCommand(ozoneEnvironment.stopDeploy, { reportFailure: false });
  const last = status.data?.target ?? null;
  const [where, setWhere] = useState<Where>(last?.host == null ? "here" : "server");
  const [host, setHost] = useState(last?.host ?? "");
  const [publicUrl, setPublicUrl] = useState(last?.publicUrl ?? "");
  const [domain, setDomain] = useState(last?.domain ?? "");
  const [pane, setPane] = useState<Pane>("deploy");
  const [bringData, setBringData] = useState(true);
  const [working, setWorking] = useState<"deploy" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedHost = host.trim();
  const trimmedUrl = publicUrl.trim();
  const trimmedDomain = domain.trim().toLowerCase();
  const problem =
    where === "server" && !HOST.test(trimmedHost)
      ? "Name the server as user@host, the way ssh reaches it."
      : trimmedDomain.length > 0 && !DOMAIN.test(trimmedDomain)
        ? "Name the domain without https://, such as notes.example.com."
        : trimmedUrl.length > 0 && !URL_PATTERN.test(trimmedUrl)
          ? "The public address starts with http:// or https://."
          : null;
  const current = status.data;
  const busy = working !== null || current?.state === "deploying";
  const refreshStatus = status.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server's deploy status, which says which step runs, while a deploy is under way
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(refreshStatus, 2_000);
    return () => window.clearInterval(timer);
  }, [busy, refreshStatus]);
  // Somewhere other than where it runs now: its data can come along.
  const chosenHost = where === "server" ? trimmedHost : null;
  const movesFrom =
    last !== null && problem === null && chosenHost !== last.host
      ? last.host === null
        ? "this machine"
        : last.host.replace(/^[^@]*@/, "")
      : null;

  const run = async (action: "deploy" | "stop", acceptMigrations = false) => {
    setWorking(action);
    setError(null);
    const result =
      action === "deploy"
        ? await deploy({
            environmentId: props.environmentId,
            input: {
              projectId: props.app.projectId,
              target: {
                host: where === "server" ? trimmedHost : null,
                publicUrl: trimmedDomain.length === 0 && trimmedUrl.length > 0 ? trimmedUrl : null,
                domain: trimmedDomain.length > 0 ? trimmedDomain : null,
              },
              ...(acceptMigrations ? { acceptMigrations } : {}),
              ...(movesFrom !== null && bringData ? { bringData } : {}),
            },
          })
        : await stopDeploy(target);
    setWorking(null);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "That did not work.");
    }
    status.refresh();
  };
  // A migration that can lose data runs in production only when the person says so.
  const applyMigration = async (statements: string) => {
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        [
          `Deploy ${props.app.name} and run the migration it held back?`,
          statements,
          "A snapshot of the production data is taken first, unless this is the first deploy here.",
        ].join("\n"),
        { variant: "destructive" },
      )
      .catch(() => false);
    if (confirmed) await run("deploy", true);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Deploy {props.app.name}</DialogTitle>
        <DialogDescription>
          Builds the last commit for production and runs it with a database of its own. Each later
          deploy saves the production data before its migrations run. The app you are building, and
          its data, are not touched.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <ToggleGroup
            aria-label="Deploy pages"
            value={[pane]}
            onValueChange={(next) => {
              const value = next[0];
              if (
                value === "deploy" ||
                value === "history" ||
                value === "monitor" ||
                value === "settings"
              )
                setPane(value);
            }}
          >
            <Toggle value="deploy">Deploy</Toggle>
            <Toggle value="history">History</Toggle>
            <Toggle disabled={last === null} value="monitor">
              Monitor
            </Toggle>
            <Toggle value="settings">Settings</Toggle>
          </ToggleGroup>
          {current === null || current === undefined ? null : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-foreground">
                {current.state === "deploying" ? <Spinner className="size-4 shrink-0" /> : null}
                <span className="min-w-0">{statusLine(current)}</span>
              </span>
              {current.url !== null && current.state === "running" ? (
                <a
                  className="flex shrink-0 items-center gap-1 text-primary text-sm hover:underline"
                  href={current.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {current.url.replace(/^https?:\/\//, "")}
                  <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                </a>
              ) : null}
            </div>
          )}
          {current?.migration ? (
            <Alert variant="warning">
              <AlertDescription>
                <p>A migration that can lose data was held back. Production was not changed.</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                  {current.migration}
                </pre>
                <Button
                  disabled={busy || problem !== null}
                  size="sm"
                  variant="outline"
                  onClick={() => void applyMigration(current.migration ?? "")}
                >
                  Deploy and apply it
                </Button>
              </AlertDescription>
            </Alert>
          ) : current?.state === "failed" && current.message !== null ? (
            <Alert variant="error">
              <AlertDescription>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                  {current.message}
                </pre>
              </AlertDescription>
            </Alert>
          ) : null}
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {pane === "history" ? (
            <DeployHistory
              app={props.app}
              busy={busy}
              environmentId={props.environmentId}
              onDeployed={status.refresh}
            />
          ) : pane === "monitor" && last !== null ? (
            <DeployMonitor app={props.app} environmentId={props.environmentId} host={last.host} />
          ) : pane === "settings" ? (
            <DeploySettings
              app={props.app}
              deployed={last !== null}
              environmentId={props.environmentId}
            />
          ) : (
            <>
              <ToggleGroup
                aria-label="Where to deploy"
                disabled={busy}
                value={[where]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "here" || value === "server") setWhere(value);
                }}
              >
                <Toggle value="here">This machine</Toggle>
                <Toggle value="server">
                  <ServerIcon />A server
                </Toggle>
              </ToggleGroup>
              {where === "server" ? (
                <div className="flex flex-col gap-2">
                  <Input
                    aria-label="Server"
                    autoComplete="off"
                    disabled={busy}
                    placeholder="deploy@example.com"
                    spellCheck={false}
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Ozone runs Docker on it over SSH, with the keys this machine already uses for
                    it.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <Input
                  aria-label="Domain"
                  autoComplete="off"
                  disabled={busy}
                  placeholder={`Domain, such as ${props.app.slug.replace(/-[0-9a-f]{6}$/, "")}.example.com (optional)`}
                  spellCheck={false}
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {trimmedDomain.length > 0
                    ? `Point ${trimmedDomain} at ${where === "server" ? "the server" : "this machine"} in your DNS first. Ozone serves it over HTTPS with a certificate from Let's Encrypt, and each new version takes over without the app going down.`
                    : "Without a domain, the app answers on its own port."}
                </p>
                {trimmedDomain.length === 0 && (last?.publicUrl ?? null) !== null ? (
                  <Input
                    aria-label="Public address"
                    autoComplete="off"
                    disabled={busy}
                    placeholder="Public address, if a proxy of your own serves it"
                    spellCheck={false}
                    value={publicUrl}
                    onChange={(event) => setPublicUrl(event.target.value)}
                  />
                ) : null}
                {problem === null ? null : (
                  <p className="text-destructive-foreground text-xs">{problem}</p>
                )}
              </div>
              {where === "server" && HOST.test(trimmedHost) ? (
                <ServerCheck environmentId={props.environmentId} host={trimmedHost} />
              ) : null}
              {movesFrom === null ? null : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ozone-bring-data">Bring the data from {movesFrom}</Label>
                    <p className="text-muted-foreground text-sm">
                      On a first deploy there, it starts from a copy of that data, and the deploy on{" "}
                      {movesFrom} is stopped once it runs. The data there stays where it is.
                    </p>
                  </div>
                  <Switch
                    id="ozone-bring-data"
                    checked={bringData}
                    disabled={busy}
                    onCheckedChange={setBringData}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        {current?.state === "running" ? (
          <Button disabled={busy} variant="outline" onClick={() => void run("stop")}>
            {working === "stop" ? <Spinner /> : <SquareIcon />}
            Stop
          </Button>
        ) : null}
        <Button disabled={busy || problem !== null} onClick={() => void run("deploy")}>
          {working === "deploy" || current?.state === "deploying" ? <Spinner /> : <RocketIcon />}
          {current === null || current === undefined || current.state === "none"
            ? "Deploy"
            : "Deploy again"}
        </Button>
      </DialogFooter>
    </>
  );
}
