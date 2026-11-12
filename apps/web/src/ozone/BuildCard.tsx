import {
  buildHeadline,
  CRITERION_LABEL,
  taskStateLabel,
} from "@t3tools/client-runtime/state/ozone";
import type {
  OzoneBuild,
  OzoneBuildSnapshot,
  OzoneBuildTask,
  OzoneCriterionResult,
} from "@t3tools/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  ListChecksIcon,
  PlayIcon,
} from "lucide-react";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

function TaskIcon({ task }: { readonly task: OzoneBuildTask }) {
  switch (task.status) {
    case "done":
      return <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-success" />;
    case "blocked":
      return <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0 text-warning" />;
    case "skipped":
      return (
        <CircleSlashIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      );
    case "running":
    case "checking":
      return <Spinner className="size-3.5 shrink-0" />;
    case "pending":
      return (
        <CircleDashedIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      );
  }
}

function CriterionIcon({ result }: { readonly result: OzoneCriterionResult }) {
  switch (result.verdict) {
    case "pass":
      return <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-success" />;
    case "fail":
      return <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0 text-warning" />;
    case "unchecked":
      return (
        <CircleDashedIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      );
  }
}

function BuildDetail({ build }: { readonly build: OzoneBuild }) {
  const results = build.verification.results;
  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
      <ol aria-label="Tasks" className="m-0 flex list-none flex-col gap-1 p-0">
        {build.tasks.map((task) => (
          <li key={task.id} className="flex min-w-0 items-center gap-2 text-xs">
            <TaskIcon task={task} />
            <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
            <span className="shrink-0 text-muted-foreground">{taskStateLabel(task, build)}</span>
          </li>
        ))}
      </ol>
      {results.length === 0 ? null : (
        <ul aria-label="Browser test" className="m-0 flex list-none flex-col gap-1 p-0">
          {results.map((result) => (
            <li key={result.criterion} className="flex min-w-0 items-start gap-2 text-xs">
              <CriterionIcon result={result} />
              <span className="min-w-0 flex-1 text-foreground">
                {result.criterion}
                {result.verdict === "fail" && result.note.length > 0 ? (
                  <span className="block text-muted-foreground">{result.note}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {CRITERION_LABEL[result.verdict]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The build of a lead thread as one composer notice, or nothing before there is a plan. */
export function buildBannerItem(
  snapshot: OzoneBuildSnapshot | null,
  onApprove: () => void,
): ComposerBannerStackItem | null {
  const headline = buildHeadline(snapshot);
  const build = snapshot?.build ?? null;
  if (headline === null || build === null) return null;
  return {
    id: "ozone-build",
    variant: headline.tone,
    group: snapshot?.status === "review" ? "attention" : "environment",
    icon: headline.busy ? <Spinner /> : <ListChecksIcon />,
    title: headline.title,
    ...(headline.detail === undefined ? {} : { description: headline.detail }),
    ...(snapshot?.status === "review"
      ? {
          actions: (
            <Button size="xs" onClick={onApprove}>
              <PlayIcon />
              Start building
            </Button>
          ),
        }
      : {}),
    children: <BuildDetail build={build} />,
  };
}
