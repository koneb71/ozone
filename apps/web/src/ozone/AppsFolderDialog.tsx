import { resolvePastedPath } from "@t3tools/shared/path";
import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";

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
import { Spinner } from "~/components/ui/spinner";
import { readLocalApi } from "~/localApi";

/**
 * Asked once, before the first app is made: the folder apps are kept in. The path is one on the
 * server's machine, so the native folder dialog is offered only when that machine is this one.
 */
export function AppsFolderDialog(props: {
  /** Ozone's own folder, offered as the starting value. */
  readonly defaultDirectory: string;
  /** Names the machine when it is not this one. */
  readonly machine: string | null;
  readonly canBrowse: boolean;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (directory: string) => void;
}) {
  const [directory, setDirectory] = useState(props.defaultDirectory);
  const chosen = directory.trim();

  const browse = async () => {
    const picked = await readLocalApi()?.dialogs.pickFolder(
      chosen.length > 0 ? { initialPath: chosen } : undefined,
    );
    if (picked) setDirectory(picked);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.saving) props.onCancel();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen.length > 0 && !props.saving) props.onConfirm(chosen);
          }}
        >
          <DialogHeader>
            <DialogTitle>Where should Ozone keep your apps?</DialogTitle>
            <DialogDescription>
              Each app gets its own folder inside
              {props.machine === null ? "" : `, on ${props.machine}`}. You can change this in
              Settings.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Folder for your apps"
                autoFocus
                className="min-w-0 flex-1"
                disabled={props.saving}
                spellCheck={false}
                value={directory}
                onChange={(event) => {
                  const next = event.target.value;
                  setDirectory((previous) => resolvePastedPath(previous, next));
                }}
              />
              {props.canBrowse ? (
                <Button
                  disabled={props.saving}
                  type="button"
                  variant="outline"
                  onClick={() => void browse()}
                >
                  <FolderOpenIcon />
                  Browse…
                </Button>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              disabled={props.saving}
              type="button"
              variant="outline"
              onClick={props.onCancel}
            >
              Cancel
            </Button>
            <Button disabled={chosen.length === 0 || props.saving} type="submit">
              {props.saving ? <Spinner /> : null}
              Use this folder
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
