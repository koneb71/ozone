import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Spinner } from "~/components/ui/spinner";

/** A section's rows while its data loads, when it fails, or when there is none: as Settings does. */
export function LoadingRow(props: { readonly label: string }) {
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

function ErrorRow(props: { readonly message: string }) {
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
          Could not load this
        </span>
      }
      description={props.message}
    />
  );
}

export function EmptyRow(props: { readonly title: string; readonly description?: string }) {
  return <SettingsRow title={props.title} description={props.description} />;
}

/** Loading, failure and empty, in that order, before the rows themselves. */
export function SectionRows<T>(props: {
  readonly items: ReadonlyArray<T> | null;
  readonly error: string | null;
  readonly loadingLabel: string;
  readonly empty: ReactNode;
  readonly children: (items: ReadonlyArray<T>) => ReactNode;
}) {
  if (props.error !== null && props.items === null) return <ErrorRow message={props.error} />;
  if (props.items === null) return <LoadingRow label={props.loadingLabel} />;
  if (props.items.length === 0) return props.empty;
  return props.children(props.items);
}
