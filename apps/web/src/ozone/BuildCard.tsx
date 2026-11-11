import type { OzoneBuild, OzoneBuildSnapshot, OzoneBuildTask } from "@t3tools/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  ListChecksIcon,
} from "lucide-react";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { Spinner } from "~/components/ui/spinner";

import { buildHeadline, taskStateLabel } from "./build.logic";

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

function TaskList({ build }: { readonly build: OzoneBuild }) {
  return (
    <ol className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0">
      {build.tasks.map((task) => (
        <li key={task.id} className="flex min-w-0 items-center gap-2 text-xs">
          <TaskIcon task={task} />
          <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
          <span className="shrink-0 text-muted-foreground">{taskStateLabel(task, build)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The build of a lead thread as one composer notice, or nothing before there is a plan. */
export function buildBannerItem(
  snapshot: OzoneBuildSnapshot | null,
): ComposerBannerStackItem | null {
  const headline = buildHeadline(snapshot);
  const build = snapshot?.build ?? null;
  if (headline === null || build === null) return null;
  return {
    id: "ozone-build",
    variant: headline.tone,
    group: "environment",
    icon: headline.busy ? <Spinner /> : <ListChecksIcon />,
    title: headline.title,
    ...(headline.detail === undefined ? {} : { description: headline.detail }),
    children: <TaskList build={build} />,
  };
}
