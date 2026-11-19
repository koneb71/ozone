import type { EnvironmentId, OzoneSavedServer } from "@t3tools/contracts";
import { CopyIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
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
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { metaLine } from "../appPage.logic";
import {
  HOST_INFO,
  isHostMethod,
  SERVER_METHOD_LABEL,
  serverFromDraft,
  type ServerMethod,
} from "../deploy.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { useOzoneCommand } from "../ui/useOzoneCommand";
import { DeployedAppsSection } from "./DeployedApps";
import { ServerSection } from "./ServerRows";

const METHODS: ReadonlyArray<ServerMethod> = [
  "own-keys",
  "ozone-key",
  "password",
  "dokploy",
  "railway",
  "render",
  "koyeb",
  "vercel",
];

const serverLine = (server: OzoneSavedServer) => {
  switch (server.kind) {
    case "ssh":
      return metaLine([
        server.host,
        server.access === "ozone-key" ? "Ozone's key" : "This computer's SSH keys",
      ]);
    case "dokploy":
      return metaLine(["Dokploy", server.url.replace(/^https?:\/\//, ""), `key ${server.keyHint}`]);
    case "host":
      return metaLine([HOST_INFO[server.provider].label, `token ${server.keyHint}`]);
  }
};

/** The servers every app can be deployed to, added once. */
export function ServersSection(props: { readonly environmentId: EnvironmentId }) {
  const servers = useEnvironmentQuery(
    ozoneEnvironment.savedServers({ environmentId: props.environmentId, input: {} }),
  );
  const removeServer = useAtomCommand(ozoneEnvironment.removeServer, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OzoneSavedServer | null>(null);

  const remove = async (server: OzoneSavedServer) => {
    const result = await run(server.id, `Could not remove ${server.name}`, () =>
      removeServer({ environmentId: props.environmentId, input: { id: server.id } }),
    );
    if (result._tag === "Success" && result.value.problem !== null) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: `${server.name} is removed from the list`,
          description: result.value.problem,
        }),
      );
    }
    servers.refresh();
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Servers"
        headerAction={
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add server
          </Button>
        }
      >
        <SectionRows
          items={servers.data?.servers ?? null}
          error={servers.error}
          loadingLabel="Loading servers"
          empty={
            <EmptyRow
              title="No servers yet"
              description="Add a server over SSH, a Dokploy instance, or a hosting account such as Railway or Vercel, and deploy any app to it."
            />
          }
        >
          {(list) =>
            list.map((server) => (
              <SettingsRow
                key={server.id}
                title={server.name}
                description={serverLine(server)}
                control={
                  <div className="flex items-center gap-1">
                    {server.kind === "ssh" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setOpen(open === server.id ? null : server.id)}
                      >
                        {open === server.id ? "Hide" : "Check"}
                      </Button>
                    ) : null}
                    <Menu>
                      <MenuTrigger
                        aria-label={`More for ${server.name}`}
                        disabled={working !== null}
                        render={<Button size="icon-xs" variant="ghost" />}
                      >
                        {working === server.id ? <Spinner /> : <EllipsisIcon />}
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem variant="destructive" onClick={() => setRemoving(server)}>
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
      <DeployedAppsSection environmentId={props.environmentId} />
      {(servers.data?.servers ?? []).map((server) =>
        server.kind === "ssh" && open === server.id ? (
          <ServerSection key={server.id} environmentId={props.environmentId} host={server.host} />
        ) : null,
      )}
      {adding ? (
        <AddServerDialog
          environmentId={props.environmentId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            servers.refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? "the server"}?`}
        description={
          removing?.kind === "dokploy"
            ? "Apps deployed there keep running in Dokploy, but Ozone can no longer deploy or stop them. Its API key is forgotten."
            : removing?.kind === "host"
              ? "Apps deployed there keep running on the host, but Ozone can no longer deploy or stop them. Its token is forgotten."
              : removing?.kind === "ssh" && removing.access === "ozone-key"
                ? "Ozone takes its key off the server. Apps deployed there keep running, and Ozone can no longer reach them: delete any you no longer want first."
                : "Apps deployed there keep running."
        }
        confirmLabel="Remove server"
        destructive
        onConfirm={() => {
          if (removing !== null) void remove(removing);
        }}
      />
    </SettingsPageContainer>
  );
}

function AddServerDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const addServer = useAtomCommand(ozoneEnvironment.addServer, { reportFailure: false });
  const serverKey = useAtomCommand(ozoneEnvironment.serverKey, { reportFailure: false });
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const { working, run } = useOzoneCommand();
  const [method, setMethod] = useState<ServerMethod>("ozone-key");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [command, setCommand] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const showCommand = async () => {
    const result = await run("key", "Could not make Ozone's SSH key", () =>
      serverKey({ environmentId: props.environmentId, input: {} }),
    );
    if (result._tag === "Success") setCommand(result.value.installCommand);
  };
  const choose = (next: ServerMethod) => {
    setMethod(next);
    setProblem(null);
  };
  const save = async () => {
    const built = serverFromDraft({ method, name, host, password, url, apiKey });
    if ("problem" in built) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    const result = await run("save", "Could not add the server", () =>
      addServer({ environmentId: props.environmentId, input: built.server }),
    );
    if (result._tag === "Success") props.onSaved();
  };

  const hosted = isHostMethod(method);
  const ssh = method !== "dokploy" && !hosted;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a server</DialogTitle>
          <DialogDescription>
            Ozone signs in once before keeping it, so a server that does not answer is never saved.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="ozone-add-server"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="ozone-server-method">How Ozone gets in</Label>
              <Select
                value={method}
                onValueChange={(value) => {
                  if (METHODS.includes(value as ServerMethod)) choose(value as ServerMethod);
                }}
              >
                <SelectTrigger id="ozone-server-method" aria-label="How Ozone gets in">
                  <SelectValue>{SERVER_METHOD_LABEL[method]}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {METHODS.map((value) => (
                    <SelectItem key={value} hideIndicator value={value}>
                      {SERVER_METHOD_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {ssh ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ozone-server-host">Server</Label>
                <Input
                  id="ozone-server-host"
                  autoComplete="off"
                  placeholder="root@203.0.113.7"
                  spellCheck={false}
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  As user@host, with :port when it is not 22.
                </p>
              </div>
            ) : hosted ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ozone-server-key">Token</Label>
                <Input
                  id="ozone-server-key"
                  autoComplete="off"
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {HOST_INFO[method].token} Ozone keeps it and never shows it again.
                </p>
                <p className="text-muted-foreground text-xs">{HOST_INFO[method].note}</p>
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="ozone-server-url">Dokploy address</Label>
                  <Input
                    id="ozone-server-url"
                    autoComplete="off"
                    placeholder="https://dokploy.example.com"
                    spellCheck={false}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ozone-server-key">API key</Label>
                  <Input
                    id="ozone-server-key"
                    autoComplete="off"
                    spellCheck={false}
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    From Dokploy's Settings → Profile → API/CLI. Ozone keeps it and never shows it
                    again. Apps deploy from their Git remote, which Dokploy must be able to clone.
                  </p>
                </div>
              </>
            )}
            {method === "password" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ozone-server-password">Password</Label>
                <Input
                  id="ozone-server-password"
                  autoComplete="off"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Used once to put Ozone's key on the server, then forgotten.
                </p>
              </div>
            ) : null}
            {method === "ozone-key" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ozone-server-command">Run this on the server first</Label>
                {command === null ? (
                  <div>
                    <Button
                      disabled={working !== null}
                      size="sm"
                      variant="outline"
                      onClick={() => void showCommand()}
                    >
                      {working === "key" ? <Spinner /> : null}
                      Show the command
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Input id="ozone-server-command" readOnly spellCheck={false} value={command} />
                    <Button
                      aria-label={isCopied ? "Copied" : "Copy the command"}
                      size="icon-sm"
                      variant="outline"
                      onClick={() => copyToClipboard(command, undefined)}
                    >
                      <CopyIcon />
                    </Button>
                  </div>
                )}
                <p className="text-muted-foreground text-xs">
                  As the user Ozone signs in as. It lets Ozone's key in, beside any keys already
                  there.
                </p>
              </div>
            ) : null}
            {method === "own-keys" ? (
              <p className="text-muted-foreground text-xs">
                Works when `ssh user@host` already signs in from this computer without a password.
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="ozone-server-name">Name</Label>
              <Input
                id="ozone-server-name"
                autoComplete="off"
                placeholder={ssh ? "Production" : hosted ? HOST_INFO[method].label : "Dokploy"}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
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
          <Button type="submit" form="ozone-add-server" disabled={working !== null}>
            {working === "save" ? <Spinner /> : null}
            Add server
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
