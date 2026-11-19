import type {
  EnvironmentId,
  OzoneApp,
  OzoneDeployStatus,
  OzoneDeployTarget,
  OzoneSavedServer,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CopyIcon, EllipsisIcon, ExternalLinkIcon, RocketIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { metaLine } from "../appPage.logic";
import {
  DOMAIN,
  HOST,
  HOST_INFO,
  deployActionOf,
  deployStateLine,
  deployTone,
  isBehind,
  sameTarget,
} from "../deploy.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { LoadingRow } from "../ui/SectionRows";
import { OutputView } from "../ui/OutputView";
import { StatusDot } from "../ui/StatusDot";
import { useOzoneCommand } from "../ui/useOzoneCommand";
import { VariablesSection } from "../ui/VariablesSection";
import { DeploymentRow, useDeleteDeployment } from "./DeployedApps";
import { RemoteRow, useAppRemote } from "./RemoteRow";
import { ServerSection } from "./ServerRows";
import type { AppDeploy } from "./useAppDeploy";

const URL_PATTERN = /^https?:\/\/\S+$/;
const placeOf = (target: Pick<OzoneDeployTarget, "host" | "dokploy" | "hosted">) =>
  target.dokploy !== null
    ? "Dokploy"
    : target.hosted !== null
      ? "the hosting platform"
      : target.host === null
        ? "this computer"
        : target.host.replace(/^[^@]*@/, "");
/** The picker's value for a host typed before servers could be saved. */
const TYPED = "typed";

/** Runs the app's production build where people can reach it. */
export function DeploySection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deploy: AppDeploy;
}) {
  const status = props.deploy.status;
  const saved = useEnvironmentQuery(
    ozoneEnvironment.savedServers({ environmentId: props.environmentId, input: {} }),
  );
  return (
    <SettingsPageContainer>
      {status === null || (saved.data === null && saved.error === null) ? (
        <SettingsSection title="Production">
          <LoadingRow label="Loading the deploy" />
        </SettingsSection>
      ) : !props.deploy.deployable ? (
        <SettingsSection title="Production">
          <SettingsRow
            title="Nothing to deploy yet"
            description="Start the app once, then you can deploy it."
          />
        </SettingsSection>
      ) : (
        // The form starts from where the app was last deployed, once that is known.
        <DeployForm {...props} status={status} servers={saved.data?.servers ?? []} />
      )}
    </SettingsPageContainer>
  );
}

function DeployForm(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deploy: AppDeploy;
  readonly status: OzoneDeployStatus;
  readonly servers: ReadonlyArray<OzoneSavedServer>;
}) {
  const { status, servers } = props;
  const last = status.target;
  const lastServer =
    last === null
      ? null
      : (servers.find((server) =>
          server.kind === "dokploy"
            ? server.id === last.dokploy
            : server.kind === "host"
              ? server.id === last.hosted
              : server.host === last.host,
        ) ?? null);
  const deploy = useAtomCommand(ozoneEnvironment.deploy, { reportFailure: false });
  const stopDeploy = useAtomCommand(ozoneEnvironment.stopDeploy, { reportFailure: false });
  const { working, busy, run } = props.deploy;
  const [where, setWhere] = useState<"here" | "server">(
    last === null || (last.host === null && last.dokploy === null && last.hosted === null)
      ? "here"
      : "server",
  );
  // A host typed before servers could be saved stays choosable as it was.
  const typedHost = last?.host != null && lastServer === null ? last.host : null;
  const [serverId, setServerId] = useState<string>(
    lastServer?.id ?? (typedHost !== null ? TYPED : (servers[0]?.id ?? "")),
  );
  const chosen = servers.find((server) => server.id === serverId) ?? null;
  const [domain, setDomain] = useState(last?.domain ?? "");
  const [publicUrl, setPublicUrl] = useState(last?.publicUrl ?? "");
  const [bringData, setBringData] = useState(true);
  const [confirm, setConfirm] = useState<"stop" | "migrate" | null>(null);
  // Where this app is deployed, now and before, as the list in Settings shows it.
  const places = useEnvironmentQuery(
    ozoneEnvironment.deployments({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId },
    }),
  );
  const deleting = useDeleteDeployment({
    environmentId: props.environmentId,
    run,
    onDeleted: places.refresh,
  });
  const currentPlace = places.data?.deployments.find((row) => row.current) ?? null;
  const otherPlaces = places.data?.deployments.filter((row) => !row.current) ?? [];

  const trimmedHost =
    serverId === TYPED ? (typedHost ?? "") : chosen?.kind === "ssh" ? chosen.host : "";
  const trimmedDomain = domain.trim().toLowerCase();
  const trimmedUrl = publicUrl.trim();
  const hostProblem =
    where === "server" && chosen === null && !(serverId === TYPED && HOST.test(trimmedHost))
      ? "Add a server under Servers first."
      : null;
  const domainProblem =
    trimmedDomain.length > 0 && !DOMAIN.test(trimmedDomain)
      ? "Without https://, such as notes.example.com."
      : null;
  const urlProblem =
    trimmedUrl.length > 0 && !URL_PATTERN.test(trimmedUrl)
      ? "Starts with http:// or https://."
      : null;
  const remote = useAppRemote(
    props.environmentId,
    props.app.projectId,
    where === "server" ? chosen : null,
  );
  // "checking" does not hold a deploy back: the server refuses one that has no remote.
  const remoteMissing = remote.need.kind === "create" || remote.need.kind === "sign-in";
  const invalid =
    hostProblem !== null || domainProblem !== null || urlProblem !== null || remoteMissing;
  const chosenDokploy = where === "server" && chosen?.kind === "dokploy" ? chosen.id : null;
  const chosenHosted = where === "server" && chosen?.kind === "host" ? chosen.id : null;
  const chosenHost =
    where === "server" && chosenDokploy === null && chosenHosted === null ? trimmedHost : null;
  // Somewhere other than where it runs now: its data can come along, unless Dokploy keeps it.
  const movesFrom =
    last !== null &&
    !invalid &&
    last.dokploy === null &&
    last.hosted === null &&
    chosenDokploy === null &&
    chosenHosted === null &&
    chosenHost !== last.host
      ? placeOf(last)
      : null;

  const targetOf = (): OzoneDeployTarget => ({
    host: chosenHost,
    dokploy: chosenDokploy,
    hosted: chosenHosted,
    publicUrl: trimmedDomain.length === 0 && trimmedUrl.length > 0 ? trimmedUrl : null,
    // A hosting platform gives the app its address; a domain of your own is set up there.
    domain: chosenHosted === null && trimmedDomain.length > 0 ? trimmedDomain : null,
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
  };
  const stop = async () => {
    await run("stop", `Could not stop ${props.app.name}`, () =>
      stopDeploy({ environmentId: props.environmentId, input: { projectId: props.app.projectId } }),
    );
  };
  // Unchanged, the form names where the app already runs, so the button says what it sends there.
  const elsewhere = last !== null && !invalid && !sameTarget(targetOf(), last);
  const action = deployActionOf(status);
  const main =
    action.kind === "busy"
      ? action
      : last === null
        ? { label: "Deploy", primary: true }
        : elsewhere
          ? { label: "Deploy here instead", primary: true }
          : action.kind === "open"
            ? { label: "Try again", primary: true }
            : action;

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
          <AlertTitle>Last deploy failed</AlertTitle>
          <AlertDescription>
            <OutputView text={status.message} label="What went wrong" />
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection title="Production">
        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              <StatusDot {...deployTone(status)} />
              {deployStateLine(status)}
            </span>
          }
          description={
            status.deployedAt === null
              ? "Builds the last commit for production, with a database of its own."
              : metaLine([
                  `Deployed ${formatRelativeTimeLabel(status.deployedAt)}${status.commitSha === null ? "" : ` from ${status.commitSha.slice(0, 7)}`}`,
                  isBehind(status) && "A newer version is ready",
                ])
          }
          control={
            <div className="flex items-center gap-1">
              {status.state === "running" ? (
                <Button
                  disabled={busy}
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm("stop")}
                >
                  {working === "stop" ? <Spinner /> : <SquareIcon />}
                  <span className="max-sm:sr-only">Stop production</span>
                </Button>
              ) : null}
              {currentPlace === null || currentPlace.state === "elsewhere" ? null : (
                <Menu>
                  <MenuTrigger
                    aria-label="More for production"
                    disabled={busy}
                    render={<Button size="icon-sm" variant="ghost" />}
                  >
                    <EllipsisIcon />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem
                      variant="destructive"
                      disabled={!currentPlace.removable}
                      onClick={() => deleting.ask(currentPlace)}
                    >
                      Delete deployment
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              )}
              <Button
                disabled={busy || invalid}
                size="sm"
                variant={main.primary ? "default" : "outline"}
                onClick={() => void deployNow()}
              >
                {busy && working !== "stop" ? <Spinner /> : <RocketIcon />}
                {main.label}
              </Button>
            </div>
          }
        />
        {status.url !== null && status.state === "running" ? (
          <SettingsRow
            title="Address"
            control={
              <Button
                render={<a href={status.url} rel="noreferrer" target="_blank" />}
                size="xs"
                variant="ghost"
              >
                <span className="font-mono">{status.url.replace(/^https?:\/\//, "")}</span>
                <ExternalLinkIcon />
              </Button>
            }
          />
        ) : null}
      </SettingsSection>

      {otherPlaces.length === 0 ? null : (
        <SettingsSection title="Where it ran before">
          {otherPlaces.map((row) => (
            <DeploymentRow
              key={`${row.place.host ?? ""}:${row.place.dokploy ?? ""}:${row.place.hosted ?? ""}`}
              row={row}
              showApp={false}
              working={working}
              onDelete={deleting.ask}
            />
          ))}
        </SettingsSection>
      )}

      <SettingsSection title="Where it runs">
        <SettingsRow
          title="Where"
          description={
            <>
              A server you added under{" "}
              <Link
                className="underline underline-offset-2"
                params={{
                  environmentId: props.environmentId,
                  projectId: props.app.projectId,
                  section: "servers",
                }}
                to="/apps/$environmentId/$projectId/$section"
              >
                Servers
              </Link>
              , over SSH, through Dokploy, or on a hosting platform.
            </>
          }
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
            description={
              hostProblem ??
              (chosen?.kind === "host"
                ? `${HOST_INFO[chosen.provider].note} Snapshots, rollback and monitoring stay with ${HOST_INFO[chosen.provider].label}.`
                : chosenDokploy !== null
                  ? "Dokploy clones the app's Git remote, so Ozone pushes the commit there first. Snapshots, rollback and monitoring stay in Dokploy."
                  : serverId === TYPED
                    ? "Typed before it could be saved. Add it under Servers to keep it."
                    : "Ozone builds and runs the app there over SSH.")
            }
            control={
              <Select
                disabled={busy || (servers.length === 0 && typedHost === null)}
                value={serverId}
                onValueChange={(value) => {
                  if (typeof value === "string") setServerId(value);
                }}
              >
                <SelectTrigger aria-label="Server" className="sm:w-64">
                  <SelectValue>
                    {chosen?.name ?? (serverId === TYPED ? typedHost : "No servers yet")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {servers.map((server) => (
                    <SelectItem key={server.id} hideIndicator value={server.id}>
                      {server.name}
                      <span className="text-muted-foreground">
                        {server.kind === "dokploy"
                          ? " · Dokploy"
                          : server.kind === "host"
                            ? ` · ${HOST_INFO[server.provider].label}`
                            : ` · ${server.host}`}
                      </span>
                    </SelectItem>
                  ))}
                  {typedHost === null ? null : (
                    <SelectItem hideIndicator value={TYPED}>
                      {typedHost}
                    </SelectItem>
                  )}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
        {where === "server" && chosen !== null ? (
          <RemoteRow
            need={remote.need}
            creating={remote.creating}
            builder={chosen.kind === "host" ? HOST_INFO[chosen.provider].label : "Dokploy"}
            onCreate={(visibility) => void remote.create(visibility)}
          />
        ) : null}
        {chosenHosted !== null ? null : (
          <SettingsRow
            title="Domain"
            description={
              domainProblem ??
              (trimmedDomain.length > 0
                ? chosenDokploy !== null
                  ? "Point it at the Dokploy server first. Dokploy serves it over HTTPS."
                  : `Point it at ${where === "server" ? "the server" : "this computer"} first. Served over HTTPS; new versions take over without downtime.`
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
        )}
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

      {hostProblem === null ? (
        <VariablesSection
          environmentId={props.environmentId}
          scope={{
            kind: "place",
            projectId: props.app.projectId,
            place: { host: chosenHost, dokploy: chosenDokploy, hosted: chosenHosted },
            name: where === "here" ? "this computer" : (chosen?.name ?? trimmedHost),
          }}
        />
      ) : null}

      {where === "server" &&
      hostProblem === null &&
      chosenDokploy === null &&
      chosenHosted === null ? (
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
        confirmLabel="Stop production"
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
      {deleting.dialog}
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
