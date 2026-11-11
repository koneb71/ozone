import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneEnvVariable } from "@t3tools/contracts";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "./state";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** An app's environment variables: settings and secrets it reads, never kept in its repository. */
export function AppEnvDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        {props.open ? <AppEnv app={props.app} environmentId={props.environmentId} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function AppEnv(props: { readonly app: OzoneApp; readonly environmentId: EnvironmentId }) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const env = useEnvironmentQuery(ozoneEnvironment.env(target));
  const setEnv = useAtomCommand(ozoneEnvironment.setEnv, { reportFailure: false });
  const removeEnv = useAtomCommand(ozoneEnvironment.removeEnv, { reportFailure: false });
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  /** "add", or the name being removed. */
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settle = (failure: unknown, fallback: string) => {
    setWorking(null);
    setError(failure === null ? null : failure instanceof Error ? failure.message : fallback);
    env.refresh();
  };

  const trimmedName = name.trim();
  const nameProblem =
    trimmedName.length > 0 && !NAME.test(trimmedName)
      ? "A name has letters, digits and underscores, and does not start with a digit."
      : null;
  const canAdd = trimmedName.length > 0 && nameProblem === null && working === null;

  const add = async () => {
    if (!canAdd) return;
    setWorking("add");
    const result = await setEnv({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, name: trimmedName, value, secret },
    });
    if (result._tag === "Success") {
      setName("");
      setValue("");
    }
    settle(
      result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
      "Could not save the variable.",
    );
  };

  const remove = async (variable: OzoneEnvVariable) => {
    setWorking(variable.name);
    const result = await removeEnv({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, name: variable.name },
    });
    settle(
      result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
      "Could not remove the variable.",
    );
  };

  const variables = env.data?.variables ?? [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.app.name} environment</DialogTitle>
        <DialogDescription>
          Settings and secrets the app reads from its environment. They stay on this machine,
          outside the app's code, and the app restarts to use a change. A secret is never shown
          again, to you or to an agent.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {variables.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-sm">
              {env.isPending ? "Reading the variables." : "No variables yet."}
            </p>
          ) : (
            <ul className="m-0 flex max-h-[40dvh] list-none flex-col divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70 p-0">
              {variables.map((variable) => (
                <li key={variable.name} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 shrink-0 font-mono text-foreground text-sm">
                    {variable.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                    {variable.value ?? "••••••••"}
                  </span>
                  {variable.secret ? <Badge variant="outline">Secret</Badge> : null}
                  <Button
                    aria-label={`Remove ${variable.name}`}
                    disabled={working !== null}
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => void remove(variable)}
                  >
                    {working === variable.name ? <Spinner /> : <Trash2Icon />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <div className="flex gap-2">
              <Input
                aria-label="Name"
                autoComplete="off"
                placeholder="NAME"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                aria-label="Value"
                autoComplete="off"
                placeholder="value"
                spellCheck={false}
                type={secret ? "password" : "text"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm">
                <Switch size="sm" checked={secret} onCheckedChange={setSecret} />
                Secret
              </label>
              <Button disabled={!canAdd} size="sm" type="submit">
                {working === "add" ? <Spinner /> : null}
                {variables.some((variable) => variable.name === trimmedName) ? "Replace" : "Add"}
              </Button>
            </div>
            {nameProblem === null ? null : (
              <p className="text-destructive-foreground text-xs">{nameProblem}</p>
            )}
          </form>
        </div>
      </DialogPanel>
    </>
  );
}
