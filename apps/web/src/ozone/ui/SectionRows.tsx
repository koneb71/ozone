import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

/** A section's rows while its data loads, when it fails, or when there is none: as Settings does. */
function LoadingRow(props: { readonly label: string }) {
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2 font-normal text-muted-foreground">
          <Spinner size="sm" tone="muted" />
          {props.label}
        </span>
      }
    />
  );
}

export function ErrorRow(props: {
  readonly message: string;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
          Could not load this
        </span>
      }
      description={props.message}
      control={
        props.onRetry === undefined ? undefined : (
          <Button size="xs" variant="outline" onClick={props.onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

/** What a section shows before it has its data: why that failed, with a way to ask again, or that it is loading. */
export function PendingRow(props: {
  readonly error: string | null;
  readonly onRetry?: (() => void) | undefined;
  readonly loadingLabel: string;
}) {
  return props.error === null ? (
    <LoadingRow label={props.loadingLabel} />
  ) : (
    <ErrorRow message={props.error} onRetry={props.onRetry} />
  );
}

export function EmptyRow(props: { readonly title: string; readonly description?: string }) {
  return <SettingsRow title={props.title} description={props.description} />;
}

/** Loading, failure and empty, in that order, before the rows themselves. */
export function SectionRows<T>(props: {
  readonly items: ReadonlyArray<T> | null;
  readonly error: string | null;
  readonly onRetry?: (() => void) | undefined;
  readonly loadingLabel: string;
  readonly empty: ReactNode;
  readonly children: (items: ReadonlyArray<T>) => ReactNode;
}) {
  if (props.items === null) {
    return (
      <PendingRow error={props.error} onRetry={props.onRetry} loadingLabel={props.loadingLabel} />
    );
  }
  if (props.items.length === 0) return props.empty;
  return props.children(props.items);
}
