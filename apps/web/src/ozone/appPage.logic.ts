import type { OzoneDeployment, OzoneRuntimePhase } from "@t3tools/contracts";

export const APP_SECTIONS = [
  "overview",
  "data",
  "history",
  "environment",
  "build",
  "logs",
  "deploy",
  "deployments",
  "monitoring",
  "servers",
  "notifications",
] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

export const APP_SECTION_LABEL: Record<AppSection, string> = {
  overview: "Overview",
  data: "Data",
  history: "History",
  environment: "Environment",
  build: "Build",
  logs: "Logs",
  deploy: "Deploy",
  deployments: "Deployments",
  monitoring: "Monitoring",
  servers: "Servers",
  notifications: "Notifications",
};

export const APP_SECTION_GROUPS: ReadonlyArray<{
  readonly heading: string;
  readonly sections: ReadonlyArray<AppSection>;
}> = [
  { heading: "App", sections: ["overview", "data", "history", "environment", "build", "logs"] },
  { heading: "Production", sections: ["deploy", "deployments", "monitoring"] },
  { heading: "All apps", sections: ["servers", "notifications"] },
];

/** The section a path names, or the overview for one it does not. */
export function appSectionOf(value: string | undefined): AppSection {
  return APP_SECTIONS.find((section) => section === value) ?? "overview";
}

/** Sections that only mean something once the app has been deployed. */
export function needsDeploy(section: AppSection): boolean {
  return section === "deployments" || section === "monitoring";
}

/** Which of an app's actions can be offered now. Every menu asks here, so they agree. */
export function appActionsFor(input: {
  readonly phase: OzoneRuntimePhase | undefined;
  /** An action this window started has not finished. */
  readonly acting: boolean;
}) {
  const { phase } = input;
  const idle = !input.acting && phase !== "starting";
  const docker = phase !== "unavailable";
  return {
    restart: idle && (phase === "running" || phase === "unhealthy"),
    rebuild: idle && docker,
    stop: idle && docker && phase !== undefined && phase !== "stopped",
    delete: docker,
  };
}

export type DotTone = "success" | "warning" | "error" | "idle";

/** How a status dot reads an app's containers. */
export function phaseTone(phase: OzoneRuntimePhase | undefined): {
  readonly tone: DotTone;
  readonly busy: boolean;
} {
  switch (phase) {
    case "running":
      return { tone: "success", busy: false };
    case "starting":
      return { tone: "warning", busy: true };
    case "unhealthy":
    case "unavailable":
      return { tone: "warning", busy: false };
    case "failed":
      return { tone: "error", busy: false };
    case "stopped":
    case undefined:
      return { tone: "idle", busy: false };
  }
}

/** How a status dot reads one deploy. */
export function deploymentTone(outcome: OzoneDeployment["outcome"]): {
  readonly tone: DotTone;
  readonly busy: boolean;
} {
  switch (outcome) {
    case "succeeded":
      return { tone: "success", busy: false };
    case "running":
      return { tone: "warning", busy: true };
    case "failed":
      return { tone: "error", busy: false };
  }
}

/** The parts of a row's second line that are known, joined the way every list here joins them. */
export function metaLine(parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
}
