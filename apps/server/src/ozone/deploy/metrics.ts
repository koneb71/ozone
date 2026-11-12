import type { OzoneContainerMetrics } from "@t3tools/contracts";

const UNITS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1e3,
  kib: 1024,
  mb: 1e6,
  mib: 1024 ** 2,
  gb: 1e9,
  gib: 1024 ** 3,
  tb: 1e12,
  tib: 1024 ** 4,
};

/** Bytes in a size as Docker prints it, such as `10.5MiB` or `1.2kB`. */
export const parseSize = (text: string | undefined): number | null => {
  const match = /^\s*([\d.]+)\s*([A-Za-z]+)\s*$/.exec(text ?? "");
  if (match === null) return null;
  const unit = UNITS[(match[2] ?? "").toLowerCase()];
  const value = Number(match[1]);
  return unit === undefined || !Number.isFinite(value) ? null : Math.round(value * unit);
};

const parsePercent = (text: string | undefined): number | null => {
  const value = Number.parseFloat((text ?? "").replace("%", ""));
  return Number.isFinite(value) ? value : null;
};

/** Docker prints one JSON object per line; older Compose prints one array. */
const jsonLines = (text: string): ReadonlyArray<Record<string, unknown>> =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        const rows = Array.isArray(value) ? value : [value];
        return rows.filter(
          (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
        );
      } catch {
        return [];
      }
    });

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export interface ProjectContainer {
  readonly id: string;
  readonly name: string;
  readonly service: string;
  readonly state: string;
  readonly health: string | null;
}

/** The containers `docker compose ps --all --format json` lists. */
export const parseComposePs = (output: string): ReadonlyArray<ProjectContainer> =>
  jsonLines(output).flatMap((row) => {
    const id = text(row["ID"]);
    const service = text(row["Service"]);
    if (id === undefined || service === undefined) return [];
    const health = text(row["Health"]);
    return [
      {
        id,
        name: text(row["Name"]) ?? id,
        service,
        state: text(row["State"]) ?? "unknown",
        health: health === undefined || health === "" ? null : health,
      },
    ];
  });

/** Each container's use, from `docker stats --no-stream --format json`, beside what Compose said. */
export const containerMetrics = (
  containers: ReadonlyArray<ProjectContainer>,
  statsOutput: string,
): ReadonlyArray<OzoneContainerMetrics> => {
  const stats = jsonLines(statsOutput);
  return containers.map((container) => {
    const row = stats.find((entry) => {
      const id = text(entry["ID"]) ?? text(entry["Container"]) ?? "";
      return (
        (id.length > 0 && container.id.startsWith(id)) || text(entry["Name"]) === container.name
      );
    });
    const [memory, limit] = (text(row?.["MemUsage"]) ?? "").split("/");
    const [networkIn, networkOut] = (text(row?.["NetIO"]) ?? "").split("/");
    return {
      service: container.service,
      state: container.state,
      health: container.health,
      cpuPercent: parsePercent(text(row?.["CPUPerc"])),
      memoryBytes: parseSize(memory),
      memoryLimitBytes: parseSize(limit),
      networkInBytes: parseSize(networkIn),
      networkOutBytes: parseSize(networkOut),
    };
  });
};

/** Total and free bytes of the filesystem in `df -Pk <path>`'s last line. */
export const parseDiskFree = (
  output: string,
): { readonly totalBytes: number; readonly freeBytes: number } | null => {
  const line = output.trim().split("\n").at(-1) ?? "";
  const fields = line.trim().split(/\s+/);
  const total = Number(fields[1]);
  const free = Number(fields[3]);
  return fields.length >= 4 && Number.isFinite(total) && Number.isFinite(free)
    ? { totalBytes: total * 1024, freeBytes: free * 1024 }
    : null;
};
