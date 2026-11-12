import type { OzoneDeployTarget, OzoneDeployment, OzoneDeploymentEntry } from "@t3tools/contracts";

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
