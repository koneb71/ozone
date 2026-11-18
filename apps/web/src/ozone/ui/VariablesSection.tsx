import type { EnvironmentId, OzoneEnvVariable, ProjectId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
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
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyRow, SectionRows } from "./SectionRows";
import { useOzoneCommand } from "./useOzoneCommand";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whose variables: one app's, or a saved server's, which every app deployed there gets. */
export type VariablesScope =
  | { readonly kind: "app"; readonly projectId: ProjectId }
  | { readonly kind: "server"; readonly serverId: string; readonly name: string };

const copyFor = (scope: VariablesScope) =>
  scope.kind === "app"
    ? {
        title: "Variables",
        empty: "The app restarts to use a change. A secret is never shown again.",
        removed: "The app restarts without it.",
      }
    : {
        title: `Variables on ${scope.name}`,
        empty:
          "Every app deployed here gets these at its next deploy, over its own variable of the same name. A secret is never shown again.",
        removed: "Apps deployed here lose it at their next deploy.",
      };

/** Settings and secrets kept outside an app's code, for one app or for a server. */
export function VariablesSection(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: VariablesScope;
}) {
  const { environmentId, scope } = props;
  const env = useEnvironmentQuery(
    scope.kind === "app"
      ? ozoneEnvironment.env({ environmentId, input: { projectId: scope.projectId } })
      : ozoneEnvironment.serverEnv({ environmentId, input: { serverId: scope.serverId } }),
  );
  const removeEnv = useAtomCommand(ozoneEnvironment.removeEnv, { reportFailure: false });
  const removeServerEnv = useAtomCommand(ozoneEnvironment.removeServerEnv, {
    reportFailure: false,
  });
  const { working, run } = useOzoneCommand();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OzoneEnvVariable | null>(null);
  const copy = copyFor(scope);

  const remove = async (variable: OzoneEnvVariable) => {
    await run(variable.name, `Could not remove ${variable.name}`, () =>
      scope.kind === "app"
        ? removeEnv({ environmentId, input: { projectId: scope.projectId, name: variable.name } })
        : removeServerEnv({
            environmentId,
            input: { serverId: scope.serverId, name: variable.name },
          }),
    );
    env.refresh();
  };

  return (
    <>
      <SettingsSection
        title={copy.title}
        headerAction={
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add variable
          </Button>
        }
      >
        <SectionRows
          items={env.data?.variables ?? null}
          error={env.error}
          loadingLabel="Loading variables"
          empty={<EmptyRow title="No variables yet" description={copy.empty} />}
        >
          {(variables) =>
            variables.map((variable) => (
              <SettingsRow
                key={variable.name}
                title={<span className="font-mono">{variable.name}</span>}
                description={
                  variable.secret ? (
                    "Hidden"
                  ) : (
                    <span className="font-mono">
                      {variable.value === "" ? '""' : variable.value}
                    </span>
                  )
                }
                control={
                  <div className="flex items-center gap-1">
                    {variable.secret ? <Badge variant="outline">Secret</Badge> : null}
                    <Button
                      disabled={working !== null}
                      size="xs"
                      variant="ghost"
                      onClick={() => setRemoving(variable)}
                    >
                      {working === variable.name ? <Spinner /> : null}
                      Remove
                    </Button>
                  </div>
                }
              />
            ))
          }
        </SectionRows>
      </SettingsSection>
      {adding ? (
        <AddVariableDialog
          environmentId={environmentId}
          scope={scope}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            env.refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? "the variable"}?`}
        description={copy.removed}
        confirmLabel="Remove variable"
        destructive
        onConfirm={() => {
          if (removing !== null) void remove(removing);
        }}
      />
    </>
  );
}

function AddVariableDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: VariablesScope;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { environmentId, scope } = props;
  const setEnv = useAtomCommand(ozoneEnvironment.setEnv, { reportFailure: false });
  const setServerEnv = useAtomCommand(ozoneEnvironment.setServerEnv, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  const trimmedName = name.trim();
  const nameProblem =
    trimmedName.length > 0 && !NAME.test(trimmedName)
      ? "Letters, digits and underscores, not starting with a digit."
      : null;

  const save = async () => {
    if (trimmedName.length === 0 || nameProblem !== null) return;
    const variable = { name: trimmedName, value, secret };
    const result = await run("save", `Could not save ${trimmedName}`, () =>
      scope.kind === "app"
        ? setEnv({ environmentId, input: { projectId: scope.projectId, ...variable } })
        : setServerEnv({ environmentId, input: { serverId: scope.serverId, ...variable } }),
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
          <DialogTitle>Add a variable</DialogTitle>
          <DialogDescription>A variable with the same name is replaced.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="ozone-add-variable"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="ozone-variable-name">Name</Label>
              <Input
                id="ozone-variable-name"
                autoComplete="off"
                autoFocus
                aria-invalid={nameProblem !== null}
                placeholder="STRIPE_KEY"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {nameProblem === null ? null : (
                <p role="alert" className="text-destructive text-xs">
                  {nameProblem}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ozone-variable-value">Value</Label>
              <Input
                id="ozone-variable-value"
                autoComplete="off"
                spellCheck={false}
                type={secret ? "password" : "text"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="ozone-variable-secret">Secret</Label>
                <p className="text-muted-foreground text-xs">
                  Never shown again, to you or to an agent.
                </p>
              </div>
              <Switch id="ozone-variable-secret" checked={secret} onCheckedChange={setSecret} />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="ozone-add-variable"
            disabled={trimmedName.length === 0 || nameProblem !== null || working !== null}
          >
            {working === null ? null : <Spinner />}
            Save variable
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
