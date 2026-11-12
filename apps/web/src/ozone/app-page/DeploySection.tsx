import type {
  EnvironmentId,
  OzoneApp,
  OzoneDeployStatus,
  OzoneDeployTarget,
} from "@t3tools/contracts";
import { CopyIcon, ExternalLinkIcon, RocketIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { phaseTone } from "../appPage.logic";
import { DOMAIN, HOST } from "../deploy.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { LoadingRow } from "../ui/SectionRows";
import { OutputView } from "../ui/OutputView";
import { StatusDot } from "../ui/StatusDot";
import { useOzoneCommand } from "../ui/useOzoneCommand";
import { ServerSection } from "./ServerRows";

const URL_PATTERN = /^https?:\/\/\S+$/;
const placeOf = (host: string | null) =>
  host === null ? "this computer" : host.replace(/^[^@]*@/, "");

function stateLine(status: OzoneDeployStatus): string {
  // Held back before anything changed: what ran before still runs.
  if (status.migration !== null && status.state === "failed") {
    return status.deployedAt === null ? "Not deployed" : "Still on the previous version";
  }
  switch (status.state) {
    case "none":
      return "Not deployed";
    case "deploying":
      return status.message ?? "Deploying";
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "failed":
      return "The last deploy failed";
  }
}

const stateTone = (status: OzoneDeployStatus) =>
  status.state === "running"
    ? phaseTone("running")
    : status.state === "deploying"
      ? phaseTone("starting")
      : status.state === "failed"
        ? phaseTone("failed")
        : phaseTone("stopped");

/** Runs the app's production build where people can reach it. */
export function DeploySection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const status = useEnvironmentQuery(ozoneEnvironment.deployStatus(target));
  return (
    <SettingsPageContainer>
      {status.data === null ? (
        <SettingsSection title="Production">
          <LoadingRow label="Loading the deploy" />
        </SettingsSection>
      ) : (
        // The form starts from where the app was last deployed, once that is known.
        <DeployForm {...props} status={status.data} refresh={status.refresh} />
      )}
    </SettingsPageContainer>
  );
}

function DeployForm(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly status: OzoneDeployStatus;
  readonly refresh: () => void;
}) {
  const { status } = props;
  const last = status.target;
  const deploy = useAtomCommand(ozoneEnvironment.deploy, { reportFailure: false });
  const stopDeploy = useAtomCommand(ozoneEnvironment.stopDeploy, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [where, setWhere] = useState<"here" | "server">(last?.host == null ? "here" : "server");
  const [host, setHost] = useState(last?.host ?? "");
  const [domain, setDomain] = useState(last?.domain ?? "");
  const [publicUrl, setPublicUrl] = useState(last?.publicUrl ?? "");
  const [bringData, setBringData] = useState(true);
  const [confirm, setConfirm] = useState<"stop" | "migrate" | null>(null);

  const trimmedHost = host.trim();
  const trimmedDomain = domain.trim().toLowerCase();
  const trimmedUrl = publicUrl.trim();
  const hostProblem =
    where === "server" && !HOST.test(trimmedHost)
      ? "Name it as user@host, the way ssh reaches it."
      : null;
  const domainProblem =
    trimmedDomain.length > 0 && !DOMAIN.test(trimmedDomain)
      ? "Without https://, such as notes.example.com."
      : null;
  const urlProblem =
    trimmedUrl.length > 0 && !URL_PATTERN.test(trimmedUrl)
      ? "Starts with http:// or https://."
      : null;
  const invalid = hostProblem !== null || domainProblem !== null || urlProblem !== null;
  const busy = working !== null || status.state === "deploying";
  const chosenHost = where === "server" ? trimmedHost : null;
  // Somewhere other than where it runs now: its data can come along.
  const movesFrom =
    last !== null && !invalid && chosenHost !== last.host ? placeOf(last.host) : null;

  const refresh = props.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server's deploy status, which names the step that runs, while a deploy is under way
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const targetOf = (): OzoneDeployTarget => ({
    host: chosenHost,
    publicUrl: trimmedDomain.length === 0 && trimmedUrl.length > 0 ? trimmedUrl : null,
    domain: trimmedDomain.length > 0 ? trimmedDomain : null,
  });
  const deployNow = async (acceptMigrations = false) => {
    await run("deploy", `Could not deploy ${props.app.name}`, () =>
      deploy({
        environmentId: props.environmentId,
        input: {
          projectId: props.app.projectId,
          target: targetOf(),
          ...(acceptMigrations ? { acceptMigrations } : {}),
          ...(movesFrom !== null && bringData ? { bringData } : {}),
        },
      }),
    );
    props.refresh();
  };
  const stop = async () => {
    await run("stop", `Could not stop ${props.app.name}`, () =>
      stopDeploy({ environmentId: props.environmentId, input: { projectId: props.app.projectId } }),
    );
    props.refresh();
  };

  return (
    <>
      {status.migration === null ? null : (
        <Alert variant="warning">
          <AlertTitle>A migration that can lose data was held back</AlertTitle>
          <AlertDescription>
            <p>Production was not changed.</p>
            <OutputView text={status.migration} label="Held-back statements" />
            <Button
              disabled={busy || invalid}
              size="sm"
              variant="outline"
              onClick={() => setConfirm("migrate")}
            >
              Deploy and apply it
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {status.migration === null && status.state === "failed" && status.message !== null ? (
        <Alert variant="error">
          <AlertTitle>The last deploy failed</AlertTitle>
          <AlertDescription>
            <OutputView text={status.message} label="What went wrong" />
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        title="Production"
        headerAction={
          <div className="flex items-center gap-1">
            {status.state === "running" ? (
              <Button disabled={busy} size="xs" variant="ghost" onClick={() => setConfirm("stop")}>
                {working === "stop" ? <Spinner /> : <SquareIcon />}
                <span className="max-sm:sr-only">Stop</span>
              </Button>
            ) : null}
            <Button disabled={busy || invalid} size="xs" onClick={() => void deployNow()}>
              {busy && working !== "stop" ? <Spinner /> : <RocketIcon />}
              {status.state === "none" ? "Deploy" : "Deploy again"}
            </Button>
          </div>
        }
      >
        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              <StatusDot {...stateTone(status)} />
              {stateLine(status)}
            </span>
          }
          description={
            status.deployedAt === null
              ? "Builds the last commit for production, with a database of its own."
              : `Deployed ${formatRelativeTimeLabel(status.deployedAt)}${status.commitSha === null ? "" : ` from ${status.commitSha.slice(0, 7)}`}`
          }
          control={
            status.url !== null && status.state === "running" ? (
              <Button
                render={<a href={status.url} rel="noreferrer" target="_blank" />}
                size="xs"
                variant="ghost"
              >
                <span className="font-mono">{status.url.replace(/^https?:\/\//, "")}</span>
                <ExternalLinkIcon />
              </Button>
            ) : undefined
          }
        />
      </SettingsSection>

      <SettingsSection title="Target">
        <SettingsRow
          title="Where"
          description="A server is reached over SSH with this computer's keys."
          control={
            <ToggleGroup
              aria-label="Where to deploy"
              disabled={busy}
              value={[where]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "here" || value === "server") setWhere(value);
              }}
            >
              <Toggle value="here">This computer</Toggle>
              <Toggle value="server">A server</Toggle>
            </ToggleGroup>
          }
        />
        {where === "server" ? (
          <SettingsRow
            title="Server"
            description={hostProblem ?? "As user@host, the way ssh reaches it."}
            control={
              <Input
                aria-label="Server"
                aria-invalid={hostProblem !== null && trimmedHost.length > 0}
                autoComplete="off"
                className="sm:w-64"
                disabled={busy}
                placeholder="deploy@example.com"
                spellCheck={false}
                value={host}
                onChange={(event) => setHost(event.target.value)}
              />
            }
          />
        ) : null}
        <SettingsRow
          title="Domain"
          description={
            domainProblem ??
            (trimmedDomain.length > 0
              ? `Point it at ${where === "server" ? "the server" : "this computer"} first. Served over HTTPS; new versions take over without downtime.`
              : "Optional. Without one, the app answers on its own port.")
          }
          control={
            <Input
              aria-label="Domain"
              aria-invalid={domainProblem !== null}
              autoComplete="off"
              className="sm:w-64"
              disabled={busy}
              placeholder="notes.example.com"
              spellCheck={false}
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            />
          }
        />
        {trimmedDomain.length === 0 && (last?.publicUrl ?? null) !== null ? (
          <SettingsRow
            title="Public address"
            description={urlProblem ?? "When a proxy of your own serves it."}
            control={
              <Input
                aria-label="Public address"
                autoComplete="off"
                className="sm:w-64"
                disabled={busy}
                spellCheck={false}
                value={publicUrl}
                onChange={(event) => setPublicUrl(event.target.value)}
              />
            }
          />
        ) : null}
        {movesFrom === null ? null : (
          <SettingsRow
            title={`Bring the data from ${movesFrom}`}
            description={`Starts from a copy of it, then stops the deploy on ${movesFrom}. Its data stays there.`}
            control={
              <Switch
                aria-label={`Bring the data from ${movesFrom}`}
                checked={bringData}
                disabled={busy}
                onCheckedChange={setBringData}
              />
            }
          />
        )}
      </SettingsSection>

      {where === "server" && hostProblem === null ? (
        <ServerSection environmentId={props.environmentId} host={trimmedHost} />
      ) : null}

      <DeployUrlSection
        app={props.app}
        environmentId={props.environmentId}
        deployed={last !== null}
      />

      <ConfirmDialog
        open={confirm === "stop"}
        onOpenChange={(open) => setConfirm(open ? "stop" : null)}
        title={`Stop the deployed ${props.app.name}?`}
        description="People can no longer reach it. Its data is kept for the next deploy."
        confirmLabel="Stop"
        destructive
        onConfirm={() => void stop()}
      />
      <ConfirmDialog
        open={confirm === "migrate"}
        onOpenChange={(open) => setConfirm(open ? "migrate" : null)}
        title="Deploy and run the held-back migration?"
        description="A snapshot of the production data is taken first, unless this is the first deploy there."
        confirmLabel="Deploy and apply"
        destructive
        onConfirm={() => void deployNow(true)}
      />
    </>
  );
}

function DeployUrlSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deployed: boolean;
}) {
  const webhook = useAtomCommand(ozoneEnvironment.deployWebhook, { reportFailure: false });
  const origin = useEnvironmentHttpBaseUrl(props.environmentId) ?? window.location.origin;
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const { working, run } = useOzoneCommand();
  const [path, setPath] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const url = path === null ? null : new URL(path, origin).toString();

  const go = async (action: "show" | "rotate" | "disable") => {
    const result = await run(action, "Could not change the deploy URL", () =>
      webhook({
        environmentId: props.environmentId,
        input: { projectId: props.app.projectId, action },
      }),
    );
    if (result._tag === "Success") setPath(result.value.path);
  };

  return (
    <SettingsSection title="Deploy URL">
      <SettingsRow
        title={url === null ? "Deploy from a script" : "Anyone with this URL can deploy"}
        description={
          props.deployed
            ? "A POST to it deploys the last commit where the app runs."
            : "Deploy the app once to get one."
        }
        control={
          url === null ? (
            <Button
              disabled={!props.deployed || working !== null}
              size="xs"
              variant="outline"
              onClick={() => void go("show")}
            >
              {working === "show" ? <Spinner /> : null}
              Show URL
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                disabled={working !== null}
                size="xs"
                variant="ghost"
                onClick={() => void go("rotate")}
              >
                New URL
              </Button>
              <Button
                disabled={working !== null}
                size="xs"
                variant="destructive-outline"
                onClick={() => setConfirmOff(true)}
              >
                Turn off
              </Button>
            </div>
          )
        }
      >
        {url === null ? null : (
          <div className="flex items-center gap-1.5 pb-2">
            <Input aria-label="Deploy URL" readOnly spellCheck={false} value={url} />
            <Button
              aria-label={isCopied ? "Copied" : "Copy the URL"}
              size="icon-sm"
              variant="outline"
              onClick={() => copyToClipboard(url, undefined)}
            >
              <CopyIcon />
            </Button>
          </div>
        )}
      </SettingsRow>
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Turn off the deploy URL?"
        description="Whatever calls it can no longer deploy. You can make a new one later."
        confirmLabel="Turn off"
        destructive
        onConfirm={() => void go("disable")}
      />
    </SettingsSection>
  );
}
