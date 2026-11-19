import type { OzoneDeployment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  coveredVolumes,
  HISTORY_LIMIT,
  historyEntries,
  parseProbe,
  stateOf,
  withDeployment,
} from "./deployments.ts";

const here = { host: null, dokploy: null, hosted: null, publicUrl: null, domain: null };
const server = {
  host: "deploy@example.com",
  dokploy: null,
  hosted: null,
  publicUrl: null,
  domain: null,
};
const deployment = (id: string, extra: Partial<OzoneDeployment> = {}): OzoneDeployment => ({
  id,
  trigger: "person",
  target: here,
  commitSha: `sha-${id}`,
  title: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:01:00.000Z",
  outcome: "succeeded",
  message: null,
  snapshotId: `snap-${id}`,
  ...extra,
});

describe("historyEntries", () => {
  it("finds a version's data in the snapshot of the deploy that replaced it on the same host", () => {
    const history = [
      deployment("a"),
      // Another host's snapshot is another database.
      deployment("b", { target: server }),
      // A failed deploy did not replace anything.
      deployment("c", { outcome: "failed" }),
      deployment("d"),
    ];
    const entries = historyEntries({
      history,
      last: { target: here, commitSha: "sha-d" },
      snapshotIds: new Set(["snap-b", "snap-c", "snap-d"]),
      inFlight: false,
    });
    expect(entries.map((entry) => [entry.id, entry.current, entry.dataSnapshotId])).toEqual([
      ["d", true, null],
      ["c", false, null],
      ["b", false, null],
      ["a", false, "snap-d"],
    ]);
    // A snapshot pruned since is not offered.
    const pruned = historyEntries({
      history,
      last: null,
      snapshotIds: new Set(),
      inFlight: false,
    });
    expect(pruned.at(-1)?.dataSnapshotId).toBeNull();
  });

  it("calls a deploy cut off by a restart failed, and keeps only the newest", () => {
    const running = deployment("r", { outcome: "running", finishedAt: null });
    const [cutOff] = historyEntries({
      history: [running],
      last: null,
      snapshotIds: new Set(),
      inFlight: false,
    });
    expect(cutOff).toMatchObject({
      outcome: "failed",
      message: "Ozone stopped while this deploy ran.",
    });
    const [live] = historyEntries({
      history: [running],
      last: null,
      snapshotIds: new Set(),
      inFlight: true,
    });
    expect(live?.outcome).toBe("running");

    let history: ReadonlyArray<OzoneDeployment> = [];
    for (let index = 0; index < HISTORY_LIMIT + 2; index += 1) {
      history = withDeployment(history, deployment(String(index)));
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.id).toBe("2");
    expect(withDeployment(history, { ...deployment("2"), outcome: "failed" })[0]?.outcome).toBe(
      "failed",
    );
  });
});

it("reads only an app's own production project from what a machine holds", () => {
  // Name filters match by substring: `my-notes-prod` comes back when asking for `notes-prod`.
  const found = parseProbe(["notes", "shop"], {
    containers: "notes-prod\texited\nmy-notes-prod\trunning\n\n",
    volumes:
      "notes-prod_pgdata\tnotes-prod\nmy-notes-prod_pgdata\tmy-notes-prod\nshop-prod_pgdata\tshop-prod\n",
  });
  const notes = found.get("notes") ?? { containerStates: [], volumes: [] };
  expect(notes).toEqual({ containerStates: ["exited"], volumes: ["notes-prod_pgdata"] });
  expect(stateOf(notes)).toBe("stopped");
  expect(stateOf(found.get("shop") ?? notes)).toBe("data-only");
  expect(stateOf({ containerStates: [], volumes: [] })).toBe("gone");
  // A snapshot holds the postgres volumes, so only those are ever removed.
  expect(
    coveredVolumes(
      "notes",
      [
        { kind: "postgres", volume: "pgdata" },
        { kind: "volume", volume: "files" },
      ],
      ["notes-prod_pgdata", "notes-prod_files"],
    ),
  ).toEqual(["notes-prod_pgdata"]);
});
