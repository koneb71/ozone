import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NodeId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

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

export const OzoneBuildStatus = Schema.Literals([
  "planning",
  /** The plan waits for the person's approval. */
  "review",
  "building",
  "blocked",
  "complete",
]);
export type OzoneBuildStatus = typeof OzoneBuildStatus.Type;

/** What a verifier found for one acceptance criterion when it tried the app. */
export const OzoneCriterionResult = Schema.Struct({
  criterion: Schema.String,
  verdict: Schema.Literals(["pass", "fail", "unchecked"]),
  note: Schema.String,
});
export type OzoneCriterionResult = typeof OzoneCriterionResult.Type;

/** A tester that uses the finished app in a browser, once the final check has passed. */
export const OzoneBuildVerification = Schema.Struct({
  /**
   * `pending`: the final check passed and no tester has started. `unavailable`: nothing could be
   * tried, for example no browser. `accepted`: the lead kept the build despite what failed.
   */
  status: Schema.Literals([
    "none",
    "pending",
    "running",
    "passed",
    "failed",
    "accepted",
    "unavailable",
  ]),
  /** Every tester ever started. Names each hand-off, like a task's `dispatches`. */
  dispatches: Schema.Int,
  workerTaskId: Schema.NullOr(NodeId),
  workerThreadId: Schema.NullOr(ThreadId),
  results: Schema.Array(OzoneCriterionResult),
  note: Schema.NullOr(Schema.String),
});
export type OzoneBuildVerification = typeof OzoneBuildVerification.Type;

export const NO_OZONE_VERIFICATION: OzoneBuildVerification = {
  status: "none",
  dispatches: 0,
  workerTaskId: null,
  workerThreadId: null,
  results: [],
  note: null,
};

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
  // The fields below came later. Each has a default so a build stored before them still reads.
  approval: Schema.Literals(["not_needed", "pending", "approved"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("not_needed" as const)),
  ),
  /** The person approved a plan the lead showed in plan mode; the next plan filed here may run. */
  planGranted: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** Set while the final check runs, so a restart knows to run it again. */
  finalStartedAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  verification: OzoneBuildVerification.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(NO_OZONE_VERIFICATION)),
  ),
});
export type OzoneBuild = typeof OzoneBuild.Type;

export const OzoneBuildRuling = Schema.Literals(["retry", "skip", "accept"]);
export type OzoneBuildRuling = typeof OzoneBuildRuling.Type;

/** The id that names the verification instead of a task when the lead rules on it. */
export const OZONE_VERIFICATION_ID = "verification";

export const OzoneBuildResolveInput = Schema.Struct({
  taskId: TaskId.annotate({
    description: `A blocked task's id, or \`${OZONE_VERIFICATION_ID}\` to rule on what the tester found.`,
  }),
  ruling: OzoneBuildRuling.annotate({
    description:
      "'retry': give it to a new worker, with your `note` as guidance. 'skip': leave it out. 'accept': keep the work as it is despite what failed. For the tester's findings: 'retry' tries the app again, 'accept' keeps the build and needs a `note` saying why.",
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

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)).annotate({
  description: "A colour as #rrggbb.",
});

export const OzoneDesignFace = Schema.Struct({
  family: TrimmedNonEmptyString.check(Schema.isMaxLength(60)).annotate({
    description: "The face's name as @fontsource publishes it, such as `Work Sans`.",
  }),
  style: Schema.Literals(["serif", "sans", "mono", "display", "script"]),
});
export type OzoneDesignFace = typeof OzoneDesignFace.Type;

/** One complete look the lead offers before it plans. */
export const OzoneDesignDirection = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
  idea: TrimmedNonEmptyString.check(Schema.isMaxLength(200)).annotate({
    description: "The direction in one sentence.",
  }),
  colors: Schema.Struct({
    background: HexColor,
    surface: HexColor.annotate({ description: "Cards, inputs and raised areas." }),
    text: HexColor,
    muted: HexColor.annotate({ description: "Secondary text." }),
    accent: HexColor.annotate({ description: "Buttons and links." }),
    accentText: HexColor.annotate({ description: "Text on the accent." }),
  }),
  display: OzoneDesignFace.annotate({ description: "Headings." }),
  body: OzoneDesignFace,
  layout: TrimmedNonEmptyString.check(Schema.isMaxLength(300)).annotate({
    description: "What the first screen shows and how it is arranged.",
  }),
  mood: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
});
export type OzoneDesignDirection = typeof OzoneDesignDirection.Type;

export const OzoneDesignProposeInput = Schema.Struct({
  directions: Schema.Array(OzoneDesignDirection).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(4),
  ),
});
export type OzoneDesignProposeInput = typeof OzoneDesignProposeInput.Type;

/** Directions the person has not picked from yet. */
export const OzoneDesignProposal = Schema.Struct({
  directions: Schema.Array(OzoneDesignDirection),
  proposedAt: IsoDateTime,
});
export type OzoneDesignProposal = typeof OzoneDesignProposal.Type;

export const OzoneDesignAnswerInput = Schema.Struct({
  threadId: ThreadId,
  /** The direction picked, or null to leave the design to the lead. */
  pick: Schema.NullOr(NonNegativeInt),
});
export type OzoneDesignAnswerInput = typeof OzoneDesignAnswerInput.Type;

export const OzoneBuildSubscribeInput = Schema.Struct({ threadId: ThreadId });
export const OzoneBuildApproveInput = Schema.Struct({
  threadId: ThreadId,
  /** True when the plan was shown in the thread, in plan mode, and has not been filed yet. */
  shownInThread: Schema.optionalKey(Schema.Boolean),
});
export type OzoneBuildApproveInput = typeof OzoneBuildApproveInput.Type;
export const OzoneBuildSnapshot = Schema.Struct({
  build: Schema.NullOr(OzoneBuild),
  status: OzoneBuildStatus,
  // Defaulted so a client can read a server from before design directions.
  design: Schema.NullOr(OzoneDesignProposal).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
});
export type OzoneBuildSnapshot = typeof OzoneBuildSnapshot.Type;
