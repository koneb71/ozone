export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  if (input.stageLabel.trim().toLowerCase() === "latest") {
    return input.baseName;
  }

  return `${input.baseName} (${input.stageLabel})`;
}

/** Stage label of a web build. vite.config.ts stamps it into index.html's title too. */
export function resolveWebAppStageLabel(input: { readonly development: boolean }): string {
  return input.development ? "Dev" : "Beta";
}

/**
 * Names the open thread: `project / thread` on desktop, where the OS already
 * shows the app, with the app name appended in browser tabs.
 */
export function resolveWindowTitle(input: {
  readonly appDisplayName: string;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly desktop: boolean;
}): string {
  const threadTitle = input.threadTitle?.trim() ?? "";
  if (threadTitle === "") {
    return input.appDisplayName;
  }

  const projectTitle = input.projectTitle?.trim() ?? "";
  const context = projectTitle === "" ? threadTitle : `${projectTitle} / ${threadTitle}`;
  return input.desktop ? context : `${context} - ${input.appDisplayName}`;
}
