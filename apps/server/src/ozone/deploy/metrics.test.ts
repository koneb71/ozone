import { describe, expect, it } from "vite-plus/test";

import { containerMetrics, parseComposePs, parseDiskFree, parseSize } from "./metrics.ts";

describe("parseSize", () => {
  it.each([
    ["0B", 0],
    ["648B", 648],
    ["1.2kB", 1_200],
    ["29.1MiB", Math.round(29.1 * 1024 ** 2)],
    ["7.6GiB", Math.round(7.6 * 1024 ** 3)],
    ["1.5GB", 1_500_000_000],
    ["--", null],
    ["", null],
  ])("%s is %s bytes", (text, bytes) => {
    expect(parseSize(text)).toBe(bytes);
  });
});

it("joins what Compose and docker stats say about each container", () => {
  // Compose prints one object per line; a stopped migrate container has no stats.
  const ps = [
    '{"ID":"aaa111bbb222","Name":"notes-prod-app-2","Service":"app","State":"running","Health":"healthy"}',
    '{"ID":"ccc333ddd444","Name":"notes-prod-db-1","Service":"db","State":"running","Health":""}',
    '{"ID":"eee555fff666","Name":"notes-prod-migrate-1","Service":"migrate","State":"exited","Health":""}',
  ].join("\n");
  const stats = [
    '{"ID":"aaa111bbb222","Name":"notes-prod-app-2","CPUPerc":"1.25%","MemUsage":"80.5MiB / 1.9GiB","NetIO":"1.2kB / 648B"}',
    '{"ID":"ccc333ddd444","Name":"notes-prod-db-1","CPUPerc":"0.00%","MemUsage":"30MiB / 1.9GiB","NetIO":"0B / 0B"}',
  ].join("\n");
  const containers = parseComposePs(ps);
  expect(containers.map((container) => [container.service, container.health])).toEqual([
    ["app", "healthy"],
    ["db", null],
    ["migrate", null],
  ]);
  const [app, , migrate] = containerMetrics(containers, stats);
  expect(app).toEqual({
    service: "app",
    state: "running",
    health: "healthy",
    cpuPercent: 1.25,
    memoryBytes: Math.round(80.5 * 1024 ** 2),
    memoryLimitBytes: Math.round(1.9 * 1024 ** 3),
    networkInBytes: 1_200,
    networkOutBytes: 648,
  });
  expect(migrate).toMatchObject({ state: "exited", cpuPercent: null, memoryBytes: null });
  // Older Compose prints one array.
  expect(parseComposePs(`[${ps.split("\n").join(",")}]`)).toHaveLength(3);
});

it("reads total and free space from df", () => {
  const df = [
    "Filesystem     1024-blocks     Used Available Capacity Mounted on",
    "/dev/sda1        41152736 12345678  26677848      32% /",
  ].join("\n");
  expect(parseDiskFree(df)).toEqual({ totalBytes: 41152736 * 1024, freeBytes: 26677848 * 1024 });
  expect(parseDiskFree("df: not found")).toBeNull();
});
