import type {
  OzoneDeployTarget,
  OzoneDeployment,
  OzoneDeploymentEntry,
  OzoneDeploymentState,
  OzoneHostProvider,
} from "@t3tools/contracts";

/** Deploys kept per app, with their output. */
export const HISTORY_LIMIT = 30;

const sameHost = (left: OzoneDeployTarget, right: OzoneDeployTarget) => left.host === right.host;

/**
 * Deploys as clients see them, newest first (`history` is stored oldest first). A deploy's data is
 * the snapshot the next successful deploy on its host took before replacing it. One still marked
 * running when none is in flight was cut off by a restart.
 */
export const historyEntries = (input: {
  readonly history: ReadonlyArray<OzoneDeployment>;
  readonly last: { readonly target: OzoneDeployTarget; readonly commitSha: string | null } | null;
  readonly snapshotIds: ReadonlySet<string>;
  readonly inFlight: boolean;
}): ReadonlyArray<OzoneDeploymentEntry> => {
  const { history, last } = input;
  const current =
    last === null
      ? undefined
      : history.findLast(
          (deployment) =>
            deployment.outcome === "succeeded" &&
            sameHost(deployment.target, last.target) &&
            deployment.commitSha === last.commitSha,
        );
  return history
    .map((deployment, index): OzoneDeploymentEntry => {
      const replacedBy = history
        .slice(index + 1)
        .find(
          (later) =>
            later.outcome === "succeeded" &&
            later.snapshotId !== null &&
            sameHost(later.target, deployment.target),
        );
      const dataSnapshotId =
        deployment.outcome === "succeeded" &&
        replacedBy?.snapshotId != null &&
        input.snapshotIds.has(replacedBy.snapshotId)
          ? replacedBy.snapshotId
          : null;
      const cutOff = deployment.outcome === "running" && !input.inFlight;
      return {
        ...deployment,
        ...(cutOff
          ? { outcome: "failed" as const, message: "Ozone stopped while this deploy ran." }
          : {}),
        current: deployment === current,
        dataSnapshotId,
      };
    })
    .toReversed();
};

/** The history with `deployment` added or replaced, the oldest past the limit dropped. */
export const withDeployment = (
  history: ReadonlyArray<OzoneDeployment>,
  deployment: OzoneDeployment,
): ReadonlyArray<OzoneDeployment> => {
  const next = history.some((entry) => entry.id === deployment.id)
    ? history.map((entry) => (entry.id === deployment.id ? deployment : entry))
    : [...history, deployment];
  return next.slice(-HISTORY_LIMIT);
};

/** An app's production Compose project, which names its containers and volumes. */
const prodProject = (slug: string) => `${slug}-prod`;

const PROJECT_LABEL = "com.docker.compose.project";

/**
 * `docker ps` and `docker volume ls` arguments that find the production projects of `slugs` on one
 * machine. Name filters match by substring and are ORed, so the project label is checked after.
 */
export const probeArgs = (hostArgs: ReadonlyArray<string>, slugs: ReadonlyArray<string>) => {
  const filters = slugs.flatMap((slug) => ["--filter", `name=${prodProject(slug)}`]);
  return {
    containers: [
      ...hostArgs,
      "ps",
      "--all",
      "--format",
      `{{.Label "${PROJECT_LABEL}"}}\t{{.State}}`,
      ...filters,
    ],
    volumes: [
      ...hostArgs,
      "volume",
      "ls",
      "--format",
      `{{.Name}}\t{{.Label "${PROJECT_LABEL}"}}`,
      ...filters,
    ],
  };
};

/** What one machine holds of one app's production. */
export interface ProdFound {
  readonly containerStates: ReadonlyArray<string>;
  readonly volumes: ReadonlyArray<string>;
}

/** Reads the probes' output into what each slug has there, keeping only its own project's. */
export const parseProbe = (
  slugs: ReadonlyArray<string>,
  output: { readonly containers: string; readonly volumes: string },
): ReadonlyMap<string, ProdFound> => {
  const rows = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim().split("\t"))
      .filter((cells) => cells.length >= 2 && cells[0] !== "");
  const containers = rows(output.containers);
  const volumes = rows(output.volumes);
  return new Map(
    slugs.map((slug) => {
      const project = prodProject(slug);
      return [
        slug,
        {
          containerStates: containers
            .filter(([label]) => label === project)
            .map(([, state]) => state ?? ""),
          volumes: volumes.filter(([, label]) => label === project).map(([name]) => name ?? ""),
        },
      ] as const;
    }),
  );
};

export const stateOf = (found: ProdFound): OzoneDeploymentState =>
  found.containerStates.includes("running")
    ? "running"
    : found.containerStates.length > 0
      ? "stopped"
      : found.volumes.length > 0
        ? "data-only"
        : "gone";

/** Where a hosting platform shows its projects, for a deployment Ozone does not run. */
export const HOST_DASHBOARD: Readonly<Record<OzoneHostProvider, string>> = {
  railway: "https://railway.com/dashboard",
  render: "https://dashboard.render.com",
  koyeb: "https://app.koyeb.com",
  vercel: "https://vercel.com/dashboard",
};

/** The volumes a snapshot holds: the app's postgres services' volumes, where they exist. */
export const coveredVolumes = (
  slug: string,
  services: ReadonlyArray<{ readonly kind: string; readonly volume: string }>,
  found: ReadonlyArray<string>,
) => {
  const present = new Set(found);
  return services
    .filter((service) => service.kind === "postgres")
    .map((service) => `${prodProject(slug)}_${service.volume}`)
    .filter((name) => present.has(name));
};
