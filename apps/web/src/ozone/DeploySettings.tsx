import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneNotifyEvent } from "@t3tools/contracts";
import { CopyIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { channelFromDraft, DEFAULT_NAME, type ChannelKind } from "./deploy.logic";
import { ozoneEnvironment } from "./state";

const failureMessage = (
  result: Parameters<typeof squashAtomCommandFailure>[0],
  fallback: string,
) => {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error ? failure.message : fallback;
};

/** When the app deploys by itself, and who hears about deploys. */
export function DeploySettings(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deployed: boolean;
}) {
  const configureApp = useAtomCommand(ozoneEnvironment.configureApp, { reportFailure: false });
  const [deployOnBuild, setDeployOnBuild] = useState(props.app.settings.deployOnBuild);
  const [error, setError] = useState<string | null>(null);

  const saveAutoDeploy = async (next: boolean) => {
    setDeployOnBuild(next);
    const result = await configureApp({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, settings: { deployOnBuild: next } },
    });
    if (result._tag === "Failure") {
      setDeployOnBuild(!next);
      setError(failureMessage(result, "The setting was not saved."));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {error === null ? null : (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ozone-deploy-on-build">Deploy when a build completes</Label>
          <p className="text-muted-foreground text-sm">
            Once every check and the browser test pass, the new version goes where the app was last
            deployed.
          </p>
        </div>
        <Switch
          id="ozone-deploy-on-build"
          checked={deployOnBuild}
          disabled={!props.deployed}
          onCheckedChange={(next) => void saveAutoDeploy(next)}
        />
      </div>
      <DeployUrl app={props.app} environmentId={props.environmentId} deployed={props.deployed} />
      <NotifyChannels environmentId={props.environmentId} />
    </div>
  );
}

function DeployUrl(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deployed: boolean;
}) {
  const webhook = useAtomCommand(ozoneEnvironment.deployWebhook, { reportFailure: false });
  const origin = useEnvironmentHttpBaseUrl(props.environmentId) ?? window.location.origin;
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [path, setPath] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = path === null ? null : new URL(path, origin).toString();

  const run = async (action: "show" | "rotate" | "disable") => {
    setWorking(true);
    setError(null);
    const result = await webhook({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, action },
    });
    setWorking(false);
    if (result._tag === "Success") setPath(result.value.path);
    else setError(failureMessage(result, "That did not work."));
  };

  return (
    <section aria-label="Deploy URL" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">Deploy URL</span>
        <p className="text-muted-foreground text-sm">
          A POST to it deploys the app's last commit where it runs, from a script or another
          service. Whoever has it can deploy, so keep it like a password.
        </p>
      </div>
      {error === null ? null : <p className="text-destructive-foreground text-xs">{error}</p>}
      {url === null ? (
        <div>
          <Button
            disabled={!props.deployed || working}
            size="sm"
            variant="outline"
            onClick={() => void run("show")}
          >
            {working ? <Spinner /> : null}
            Show the URL
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            <Input aria-label="Deploy URL" readOnly spellCheck={false} value={url} />
            <Button
              aria-label={isCopied ? "Copied" : "Copy the URL"}
              size="icon"
              variant="outline"
              onClick={() => copyToClipboard(url, undefined)}
            >
              <CopyIcon />
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Button
              disabled={working}
              size="sm"
              variant="outline"
              onClick={() => void run("rotate")}
            >
              Make a new one
            </Button>
            <Button
              disabled={working}
              size="sm"
              variant="ghost-destructive"
              onClick={() => void run("disable")}
            >
              Turn it off
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

const EVENTS: ReadonlyArray<{ readonly event: OzoneNotifyEvent; readonly label: string }> = [
  { event: "deploy.succeeded", label: "A deploy succeeds" },
  { event: "deploy.failed", label: "A deploy fails" },
];

function NotifyChannels(props: { readonly environmentId: EnvironmentId }) {
  const channels = useEnvironmentQuery(
    ozoneEnvironment.notifyChannels({ environmentId: props.environmentId, input: {} }),
  );
  const setChannel = useAtomCommand(ozoneEnvironment.setNotifyChannel, { reportFailure: false });
  const removeChannel = useAtomCommand(ozoneEnvironment.removeNotifyChannel, {
    reportFailure: false,
  });
  const testChannel = useAtomCommand(ozoneEnvironment.testNotifyChannel, { reportFailure: false });
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [events, setEvents] = useState<ReadonlyArray<OzoneNotifyEvent>>([
    "deploy.succeeded",
    "deploy.failed",
  ]);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(
    null,
  );

  const add = async () => {
    const built = channelFromDraft(`${kind}-${Date.now().toString(36)}`, {
      kind,
      name,
      url,
      botToken,
      chatId,
      events,
    });
    if ("problem" in built) {
      setMessage({ ok: false, text: built.problem });
      return;
    }
    setWorking("add");
    const result = await setChannel({ environmentId: props.environmentId, input: built.channel });
    setWorking(null);
    if (result._tag === "Failure") {
      setMessage({ ok: false, text: failureMessage(result, "The channel was not saved.") });
      return;
    }
    setMessage(null);
    setName("");
    setUrl("");
    setBotToken("");
    setChatId("");
    channels.refresh();
  };
  const test = async (id: string) => {
    setWorking(id);
    const result = await testChannel({ environmentId: props.environmentId, input: { id } });
    setWorking(null);
    setMessage(
      result._tag === "Success"
        ? { ok: true, text: "Sent. Look for it there." }
        : { ok: false, text: failureMessage(result, "The message was not sent.") },
    );
  };
  const remove = async (id: string) => {
    setWorking(id);
    await removeChannel({ environmentId: props.environmentId, input: { id } });
    setWorking(null);
    channels.refresh();
  };

  return (
    <section aria-label="Notifications" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">Notifications</span>
        <p className="text-muted-foreground text-sm">
          For every app on this computer. The addresses and tokens are kept by Ozone and never shown
          again.
        </p>
      </div>
      {(channels.data?.channels ?? []).length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/70">
          {(channels.data?.channels ?? []).map((channel) => (
            <li key={channel.id} className="flex items-center gap-2 px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{channel.name}</span>
                <span className="truncate text-muted-foreground text-xs">
                  {channel.destination} ·{" "}
                  {channel.events.length === 2
                    ? "every deploy"
                    : channel.events[0] === "deploy.failed"
                      ? "failed deploys"
                      : "successful deploys"}
                </span>
              </div>
              <Button
                disabled={working !== null}
                size="xs"
                variant="outline"
                onClick={() => void test(channel.id)}
              >
                {working === channel.id ? <Spinner /> : null}
                Send a test
              </Button>
              <Button
                aria-label={`Remove ${channel.name}`}
                disabled={working !== null}
                size="icon-xs"
                variant="ghost"
                onClick={() => void remove(channel.id)}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {message === null ? null : (
        <p
          className={
            message.ok ? "text-muted-foreground text-xs" : "text-destructive-foreground text-xs"
          }
        >
          {message.text}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-xl border border-border/70 p-3">
        <ToggleGroup
          aria-label="Where to send"
          value={[kind]}
          onValueChange={(next) => {
            const value = next[0];
            if (
              value === "slack" ||
              value === "discord" ||
              value === "telegram" ||
              value === "webhook"
            )
              setKind(value);
          }}
        >
          {(["slack", "discord", "telegram", "webhook"] as const).map((value) => (
            <Toggle key={value} value={value}>
              {DEFAULT_NAME[value]}
            </Toggle>
          ))}
        </ToggleGroup>
        <Input
          aria-label="Name"
          autoComplete="off"
          placeholder={`Name, such as ${kind === "telegram" ? "My phone" : "#deploys"}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {kind === "telegram" ? (
          <div className="flex gap-1.5">
            <Input
              aria-label="Bot token"
              autoComplete="off"
              placeholder="Bot token from BotFather"
              spellCheck={false}
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
            />
            <Input
              aria-label="Chat ID"
              autoComplete="off"
              placeholder="Chat ID"
              spellCheck={false}
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
            />
          </div>
        ) : (
          <Input
            aria-label="Webhook URL"
            autoComplete="off"
            placeholder={
              kind === "webhook"
                ? "https://… (receives a JSON POST)"
                : `${DEFAULT_NAME[kind]} incoming webhook URL`
            }
            spellCheck={false}
            type="password"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
        <div className="flex flex-wrap items-center gap-4">
          {EVENTS.map(({ event, label }) => (
            <label key={event} className="flex items-center gap-2 text-sm">
              <Switch
                checked={events.includes(event)}
                onCheckedChange={(on) =>
                  setEvents(on ? [...events, event] : events.filter((entry) => entry !== event))
                }
              />
              {label}
            </label>
          ))}
          <Button
            className="ms-auto"
            disabled={working !== null}
            size="sm"
            onClick={() => void add()}
          >
            {working === "add" ? <Spinner /> : null}
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}
