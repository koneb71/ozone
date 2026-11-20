import type {
  EnvironmentId,
  OzoneNotifyChannelSummary,
  OzoneNotifyEvent,
} from "@t3tools/contracts";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { metaLine } from "../appPage.logic";
import { channelFromDraft, DEFAULT_NAME, type ChannelKind } from "../deploy.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { useOzoneCommand } from "../ui/useOzoneCommand";

const EVENTS: ReadonlyArray<{ readonly event: OzoneNotifyEvent; readonly label: string }> = [
  { event: "deploy.succeeded", label: "A deploy succeeds" },
  { event: "deploy.failed", label: "A deploy fails" },
];
const KINDS: ReadonlyArray<ChannelKind> = ["slack", "discord", "telegram", "webhook"];

const eventsLabel = (events: ReadonlyArray<OzoneNotifyEvent>) =>
  events.length === EVENTS.length
    ? "Every deploy"
    : events[0] === "deploy.failed"
      ? "Failed deploys"
      : "Successful deploys";

/** Where Ozone tells people how deploys went, for every app on this computer. */
export function NotificationsSection(props: { readonly environmentId: EnvironmentId }) {
  const channels = useEnvironmentQuery(
    ozoneEnvironment.notifyChannels({ environmentId: props.environmentId, input: {} }),
  );
  const removeChannel = useAtomCommand(ozoneEnvironment.removeNotifyChannel, {
    reportFailure: false,
  });
  const testChannel = useAtomCommand(ozoneEnvironment.testNotifyChannel, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OzoneNotifyChannelSummary | null>(null);

  const test = async (channel: OzoneNotifyChannelSummary) => {
    const result = await run(channel.id, `${channel.name} did not get the message`, () =>
      testChannel({ environmentId: props.environmentId, input: { id: channel.id } }),
    );
    if (result._tag === "Success") {
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Sent to ${channel.name}`,
          description: "Look for it there.",
        }),
      );
    }
  };
  const remove = async (channel: OzoneNotifyChannelSummary) => {
    await run(channel.id, `Could not remove ${channel.name}`, () =>
      removeChannel({ environmentId: props.environmentId, input: { id: channel.id } }),
    );
    channels.refresh();
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Channels"
        headerAction={
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add channel
          </Button>
        }
      >
        <SectionRows
          items={channels.data?.channels ?? null}
          error={channels.error}
          onRetry={channels.refresh}
          loadingLabel="Loading channels"
          empty={
            <EmptyRow
              title="No channels yet"
              description="Slack, Discord, Telegram or any webhook hears about every app's deploys."
            />
          }
        >
          {(list) =>
            list.map((channel) => (
              <SettingsRow
                key={channel.id}
                title={channel.name}
                description={metaLine([
                  DEFAULT_NAME[channel.kind],
                  channel.destination,
                  eventsLabel(channel.events),
                ])}
                control={
                  <div className="flex items-center gap-1">
                    <Button
                      disabled={working !== null}
                      size="xs"
                      variant="ghost"
                      onClick={() => void test(channel)}
                    >
                      {working === channel.id ? <Spinner /> : null}
                      Send a test
                    </Button>
                    <Menu>
                      <MenuTrigger
                        aria-label={`More for ${channel.name}`}
                        render={<Button size="icon-xs" variant="ghost" />}
                      >
                        <EllipsisIcon />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem variant="destructive" onClick={() => setRemoving(channel)}>
                          Remove
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </div>
                }
              />
            ))
          }
        </SectionRows>
      </SettingsSection>
      {adding ? (
        <AddChannelDialog
          environmentId={props.environmentId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            channels.refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? "the channel"}?`}
        description="Deploys are no longer reported there. Its address is forgotten."
        confirmLabel="Remove channel"
        destructive
        onConfirm={() => {
          if (removing !== null) void remove(removing);
        }}
      />
    </SettingsPageContainer>
  );
}

function AddChannelDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const setChannel = useAtomCommand(ozoneEnvironment.setNotifyChannel, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [events, setEvents] = useState<ReadonlyArray<OzoneNotifyEvent>>([
    "deploy.succeeded",
    "deploy.failed",
  ]);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    const built = channelFromDraft(`${kind}-${Date.now().toString(36)}`, {
      kind,
      name,
      url,
      botToken,
      chatId,
      events,
    });
    if ("problem" in built) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    const result = await run("save", "Could not add the channel", () =>
      setChannel({ environmentId: props.environmentId, input: built.channel }),
    );
    if (result._tag === "Success") props.onSaved();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a channel</DialogTitle>
          <DialogDescription>Its address is kept by Ozone and never shown again.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="ozone-add-channel"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="ozone-channel-kind">Service</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (KINDS.includes(value as ChannelKind)) setKind(value as ChannelKind);
                }}
              >
                <SelectTrigger id="ozone-channel-kind" aria-label="Service">
                  <SelectValue>{DEFAULT_NAME[kind]}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {KINDS.map((value) => (
                    <SelectItem key={value} hideIndicator value={value}>
                      {DEFAULT_NAME[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ozone-channel-name">Name</Label>
              <Input
                id="ozone-channel-name"
                autoComplete="off"
                placeholder={kind === "telegram" ? "My phone" : "#deploys"}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {kind === "telegram" ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="ozone-channel-token">Bot token</Label>
                  <Input
                    id="ozone-channel-token"
                    autoComplete="off"
                    spellCheck={false}
                    type="password"
                    value={botToken}
                    onChange={(event) => setBotToken(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    From BotFather, such as 123456:ABC-DEF.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ozone-channel-chat">Chat ID</Label>
                  <Input
                    id="ozone-channel-chat"
                    autoComplete="off"
                    spellCheck={false}
                    value={chatId}
                    onChange={(event) => setChatId(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="ozone-channel-url">
                  {kind === "webhook" ? "URL" : `${DEFAULT_NAME[kind]} webhook URL`}
                </Label>
                <Input
                  id="ozone-channel-url"
                  autoComplete="off"
                  placeholder="https://"
                  spellCheck={false}
                  type="password"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
                {kind === "webhook" ? (
                  <p className="text-muted-foreground text-xs">
                    Receives a JSON POST for each deploy.
                  </p>
                ) : null}
              </div>
            )}
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 font-medium text-sm">Tell it when</legend>
              {EVENTS.map(({ event, label }) => (
                <label key={event} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={events.includes(event)}
                    onCheckedChange={(on) =>
                      setEvents(on ? [...events, event] : events.filter((entry) => entry !== event))
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {problem === null ? null : (
              <p role="alert" className="text-destructive text-xs">
                {problem}
              </p>
            )}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ozone-add-channel" disabled={working !== null}>
            {working === null ? null : <Spinner />}
            Add channel
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
