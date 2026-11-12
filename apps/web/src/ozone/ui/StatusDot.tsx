import { ConnectionStatusDot } from "~/components/ConnectionStatusDot";

import type { DotTone } from "../appPage.logic";

const DOT_CLASS: Record<DotTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

/** The dot upstream shows beside a connection, read for an app, a deploy or a container. */
export function StatusDot(props: {
  readonly tone: DotTone;
  readonly busy?: boolean;
  readonly label?: string | undefined;
}) {
  return (
    <ConnectionStatusDot
      tooltipText={props.label ?? null}
      dotClassName={DOT_CLASS[props.tone]}
      pingClassName={props.busy === true ? "bg-warning/60 duration-2000" : null}
    />
  );
}
