import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";

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
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useEnvironmentQuery } from "~/state/query";

import { ozoneEnvironment } from "./state";

const LOG_LINES = 300;

/** The recent output of an app's containers. */
export function AppLogsDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-3xl">
        {props.open ? <AppLogs app={props.app} environmentId={props.environmentId} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function AppLogs(props: { readonly app: OzoneApp; readonly environmentId: EnvironmentId }) {
  const logs = useEnvironmentQuery(
    ozoneEnvironment.runtimeLogs({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, tail: LOG_LINES },
    }),
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.app.name} logs</DialogTitle>
        <DialogDescription>
          The last {LOG_LINES} lines from the app and its database.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <pre className="scrollbar-gutter-both max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
          {logs.error ?? logs.data?.text ?? "Reading the logs."}
        </pre>
      </DialogPanel>
      <DialogFooter>
        <Button disabled={logs.isPending} variant="outline" onClick={logs.refresh}>
          <RefreshIcon refreshing={logs.isPending} />
          Refresh
        </Button>
      </DialogFooter>
    </>
  );
}
