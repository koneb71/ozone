import { cn } from "~/lib/utils";

/** Logs, a deploy's output, SQL: text a person reads as it was printed. */
export function OutputView(props: {
  readonly text: string | null;
  /** Shown while the text is not there yet. */
  readonly placeholder?: string;
  readonly size?: "default" | "tall";
  readonly label?: string;
}) {
  return (
    <pre
      aria-label={props.label}
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed",
        props.size === "tall" ? "max-h-[min(60dvh,40rem)]" : "max-h-72",
        props.text === null || props.text.length === 0
          ? "text-muted-foreground"
          : "text-foreground",
      )}
    >
      {props.text === null || props.text.length === 0
        ? (props.placeholder ?? "Nothing yet.")
        : props.text}
    </pre>
  );
}
