import {
  DEFAULT_OZONE_APP_SETTINGS,
  ProjectId,
  type OzoneApp,
  type OzoneAppManifest,
  type OzoneBuild,
  type OzoneBuildTask,
  type ThreadId,
} from "@t3tools/contracts";

import { emptyBuild } from "./builds/BuildModel.ts";

const AT = "2026-01-01T00:00:00.000Z";

/** An app as the registry holds it. */
export const testApp = (overrides: Partial<OzoneApp> = {}): OzoneApp => ({
  projectId: ProjectId.make("project-notes"),
  slug: "notes-a1b2c3",
  name: "Notes",
  templateId: "web-app",
  port: 41_000,
  createdAt: AT,
  settings: DEFAULT_OZONE_APP_SETTINGS,
  ...overrides,
});

export const TEST_DATABASE = { service: "db", kind: "postgres", volume: "pgdata" } as const;

export const TEST_MIGRATIONS = {
  directory: "drizzle",
  generate: "npm run db:generate",
  apply: "npm run db:migrate",
};

/** The web-app template's runtime, with no gates, no data and no migrations. */
export const testManifest = (overrides: Partial<OzoneAppManifest> = {}): OzoneAppManifest => ({
  version: 1,
  runtime: {
    kind: "compose",
    file: "compose.yaml",
    appService: "app",
    appPort: 3000,
    healthPath: "/api/health",
  },
  gates: [],
  data: { services: [] },
  ...overrides,
});

/** A task nothing has happened to. */
export const testTask = (id: string, overrides: Partial<OzoneBuildTask> = {}): OzoneBuildTask => ({
  id,
  title: `Task ${id}`,
  brief: "",
  dependsOn: [],
  acceptance: [],
  access: "write",
  status: "pending",
  attempts: 0,
  dispatches: 0,
  workerTaskId: null,
  workerThreadId: null,
  baseSha: null,
  commitSha: null,
  snapshotId: null,
  evidence: [],
  summary: null,
  blockedReason: null,
  ...overrides,
});

/** A build nobody has to approve. */
export const testBuild = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: Partial<OzoneBuild> = {},
): OzoneBuild => ({ ...emptyBuild(threadId, projectId, AT), ...overrides });
