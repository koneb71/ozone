import * as Schema from "effect/Schema";

import { IsoDateTime, NodeId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const TaskId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(48),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
).annotate({
  description: "Short lowercase id, such as `habits-page`. Other tasks name it in `dependsOn`.",
});
const Line = TrimmedNonEmptyString.check(Schema.isMaxLength(400));

export const OzoneBuildTaskAccess = Schema.Literals(["write", "read"]);
export type OzoneBuildTaskAccess = typeof OzoneBuildTaskAccess.Type;

/** What the lead writes for one task. */
export const OzoneBuildTaskPlan = Schema.Struct({
  id: TaskId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  brief: TrimmedNonEmptyString.check(Schema.isMaxLength(6_000)).annotate({
    description:
      "Everything the worker needs: what to build, which files matter, and what to leave alone. The worker sees nothing else of this conversation.",
  }),
  dependsOn: Schema.optionalKey(Schema.Array(TaskId).check(Schema.isMaxLength(16))),
  acceptance: Schema.optionalKey(Schema.Array(Line).check(Schema.isMaxLength(12))),
  access: Schema.optionalKey(
    OzoneBuildTaskAccess.annotate({
      description:
        "'write' (default) changes files and runs alone. 'read' only reads, such as research or review, and may run beside other 'read' tasks.",
    }),
  ),
});
export type OzoneBuildTaskPlan = typeof OzoneBuildTaskPlan.Type;

export const OzoneBuildPlanInput = Schema.Struct({
  spec: TrimmedNonEmptyString.check(Schema.isMaxLength(12_000)).annotate({
    description: "What is being built and for whom, in plain words.",
  }),
  acceptance: Schema.Array(Line)
    .check(Schema.isMaxLength(24))
    .annotate({ description: "What a tester can check in the running app when it is done." }),
  tasks: Schema.Array(OzoneBuildTaskPlan).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
});
export type OzoneBuildPlanInput = typeof OzoneBuildPlanInput.Type;

export const OzoneBuildTaskStatus = Schema.Literals([
  "pending",
  "running",
  "checking",
  "blocked",
  "done",
  "skipped",
]);
export type OzoneBuildTaskStatus = typeof OzoneBuildTaskStatus.Type;

/** One check the server ran itself, with the end of its output when it failed. */
export const OzoneGateResult = Schema.Struct({
  id: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String,
});
export type OzoneGateResult = typeof OzoneGateResult.Type;

export const OzoneBuildTask = Schema.Struct({
  id: TaskId,
  title: Schema.String,
  brief: Schema.String,
  dependsOn: Schema.Array(Schema.String),
  acceptance: Schema.Array(Schema.String),
  access: OzoneBuildTaskAccess,
  status: OzoneBuildTaskStatus,
  /** How many workers have been given this task since it was last planned or retried. */
  attempts: Schema.Int,
  /** Every worker it was ever given. Names each hand-off, so it never goes back down. */
  dispatches: Schema.Int,
  workerTaskId: Schema.NullOr(NodeId),
  workerThreadId: Schema.NullOr(ThreadId),
  /** The commit the worker started from. */
  baseSha: Schema.NullOr(Schema.String),
  commitSha: Schema.NullOr(Schema.String),
  snapshotId: Schema.NullOr(Schema.String),
  evidence: Schema.Array(OzoneGateResult),
  summary: Schema.NullOr(Schema.String),
  blockedReason: Schema.NullOr(Schema.String),
});
export type OzoneBuildTask = typeof OzoneBuildTask.Type;

export const OzoneBuildStatus = Schema.Literals(["planning", "building", "blocked", "complete"]);
export type OzoneBuildStatus = typeof OzoneBuildStatus.Type;

/** The persisted plan and evidence of one lead thread's build. */
export const OzoneBuild = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  spec: Schema.String,
  acceptance: Schema.Array(Schema.String),
  tasks: Schema.Array(OzoneBuildTask),
  maxAttempts: Schema.Int,
  /** The checks that run once, when every task has passed. */
  finalEvidence: Schema.Array(OzoneGateResult),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type OzoneBuild = typeof OzoneBuild.Type;

export const OzoneBuildRuling = Schema.Literals(["retry", "skip", "accept"]);
export type OzoneBuildRuling = typeof OzoneBuildRuling.Type;

export const OzoneBuildResolveInput = Schema.Struct({
  taskId: TaskId,
  ruling: OzoneBuildRuling.annotate({
    description:
      "'retry': give it to a new worker, with your `note` as guidance. 'skip': leave it out. 'accept': keep the work as it is despite the failed check.",
  }),
  note: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
});
export type OzoneBuildResolveInput = typeof OzoneBuildResolveInput.Type;

/** What a build tool tells the agent that called it. Kept short: it is read on every call. */
export const OzoneBuildReport = Schema.Struct({
  status: OzoneBuildStatus,
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      status: OzoneBuildTaskStatus,
      attempts: Schema.Int,
      note: Schema.optionalKey(Schema.String),
      workerThreadId: Schema.optionalKey(ThreadId),
    }),
  ),
  next: Schema.String.annotate({ description: "What to do now. Follow it." }),
});
export type OzoneBuildReport = typeof OzoneBuildReport.Type;

export const OzoneBuildCheckResult = Schema.Struct({
  gates: Schema.Array(OzoneGateResult),
  next: Schema.String,
});
export type OzoneBuildCheckResult = typeof OzoneBuildCheckResult.Type;

export const OzoneBuildSubscribeInput = Schema.Struct({ threadId: ThreadId });
export const OzoneBuildSnapshot = Schema.Struct({
  build: Schema.NullOr(OzoneBuild),
  status: OzoneBuildStatus,
});
export type OzoneBuildSnapshot = typeof OzoneBuildSnapshot.Type;
