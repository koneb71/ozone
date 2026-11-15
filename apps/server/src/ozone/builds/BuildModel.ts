/**
 * The rules of a build, with no I/O: which plans are valid, which task may run next, and what
 * each outcome does to a task. The conductor does the work; this module decides what it means.
 */
import {
  NO_OZONE_VERIFICATION,
  type NodeId,
  type OzoneBuild,
  type OzoneBuildPlanInput,
  type OzoneBuildRuling,
  type OzoneBuildStatus,
  type OzoneBuildTask,
  type OzoneCriterionResult,
  type OzoneGateResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

const DEFAULT_MAX_ATTEMPTS = 3;

export type Decision =
  | { readonly ok: true; readonly build: OzoneBuild }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

const accepted = (build: OzoneBuild): Decision => ({ ok: true, build });
const refused = (...problems: ReadonlyArray<string>): Decision => ({ ok: false, problems });

export const emptyBuild = (threadId: ThreadId, projectId: ProjectId, now: string): OzoneBuild => ({
  threadId,
  projectId,
  spec: "",
  acceptance: [],
  tasks: [],
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  finalEvidence: [],
  completedAt: null,
  updatedAt: now,
  approval: "not_needed",
  finalStartedAt: null,
  verification: NO_OZONE_VERIFICATION,
});

const isSettled = (task: OzoneBuildTask) => task.status === "done" || task.status === "skipped";
const isActive = (task: OzoneBuildTask) => task.status === "running" || task.status === "checking";

export const statusOf = (build: OzoneBuild): OzoneBuildStatus => {
  if (build.tasks.length === 0) return "planning";
  if (build.approval === "pending") return "review";
  if (build.tasks.some((task) => task.status === "blocked")) return "blocked";
  if (!build.tasks.every(isSettled)) return "building";
  if (build.completedAt !== null) return "complete";
  // Every task passed, but the final check or the verifier found something.
  if (build.finalEvidence.some((gate) => !gate.ok)) return "blocked";
  return build.verification.status === "failed" ? "blocked" : "building";
};

/** Why a task graph cannot run, in words the lead can act on. */
export const planProblems = (
  tasks: ReadonlyArray<{ readonly id: string; readonly dependsOn?: ReadonlyArray<string> }>,
): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) problems.push(`Two tasks are called ${task.id}. Give each its own id.`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (dependency === task.id) problems.push(`Task ${task.id} depends on itself.`);
      else if (!ids.has(dependency)) {
        problems.push(`Task ${task.id} depends on ${dependency}, which is not in the plan.`);
      }
    }
  }
  if (problems.length > 0) return problems;

  // Depth-first search: a task met again while it is still being explored closes a cycle.
  const dependenciesOf = new Map(tasks.map((task) => [task.id, task.dependsOn ?? []]));
  const explored = new Set<string>();
  const path: Array<string> = [];
  const visit = (id: string): ReadonlyArray<string> | null => {
    const seenAt = path.indexOf(id);
    if (seenAt !== -1) return [...path.slice(seenAt), id];
    if (explored.has(id)) return null;
    path.push(id);
    for (const dependency of dependenciesOf.get(id) ?? []) {
      const cycle = visit(dependency);
      if (cycle !== null) return cycle;
    }
    path.pop();
    explored.add(id);
    return null;
  };
  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle !== null) return [`These tasks wait on each other: ${cycle.join(" → ")}.`];
  }
  return [];
};

const plannedTask = (plan: OzoneBuildPlanInput["tasks"][number]): OzoneBuildTask => ({
  id: plan.id,
  title: plan.title,
  brief: plan.brief,
  dependsOn: plan.dependsOn ?? [],
  acceptance: plan.acceptance ?? [],
  access: plan.access ?? "write",
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
});

/**
 * Sets or revises the plan. Work that already passed is never thrown away, and a task a worker
 * is on right now cannot be changed under it.
 */
export const applyPlan = (
  build: OzoneBuild,
  input: OzoneBuildPlanInput,
  now: string,
  options?: { readonly reviewPlans?: boolean },
): Decision => {
  const problems = [...planProblems(input.tasks)];
  const current = new Map(build.tasks.map((task) => [task.id, task]));
  const planned = new Set(input.tasks.map((task) => task.id));
  for (const task of build.tasks) {
    if (planned.has(task.id)) continue;
    if (task.status === "done") {
      problems.push(
        `Task ${task.id} is already done. Keep it in the plan; add new tasks after it.`,
      );
    } else if (isActive(task)) {
      problems.push(`Task ${task.id} is running. Keep it in the plan until it finishes.`);
    }
  }
  for (const plan of input.tasks) {
    const existing = current.get(plan.id);
    if (existing === undefined) continue;
    const changed = existing.brief !== plan.brief || existing.title !== plan.title;
    if (changed && existing.status === "done") {
      problems.push(
        `Task ${plan.id} is already done and cannot be rewritten. Add a new task for the change.`,
      );
    } else if (changed && isActive(existing)) {
      problems.push(`Task ${plan.id} is running and cannot be rewritten until it finishes.`);
    }
  }
  if (problems.length > 0) return refused(...problems);

  const tasks = input.tasks.map((plan) => {
    const existing = current.get(plan.id);
    if (existing === undefined) return plannedTask(plan);
    const fresh = plannedTask(plan);
    // A done or running task keeps its record; only what it waits on may be re-stated.
    if (existing.status === "done" || isActive(existing)) {
      return { ...existing, dependsOn: fresh.dependsOn, acceptance: fresh.acceptance };
    }
    // An unchanged pending task keeps its attempts and evidence; a rewritten one starts over.
    return existing.brief === fresh.brief && existing.status === "pending"
      ? {
          ...existing,
          ...fresh,
          attempts: existing.attempts,
          dispatches: existing.dispatches,
          evidence: existing.evidence,
        }
      : { ...fresh, dispatches: existing.dispatches };
  });
  // With plans reviewed, the person sees every task before it runs: a revision that adds or
  // rewrites one waits again, however far the build has come. Saving the same plan changes nothing.
  const addsWork = input.tasks.some((plan) => {
    const existing = current.get(plan.id);
    return existing === undefined || existing.brief !== plan.brief || existing.title !== plan.title;
  });
  const approval =
    options?.reviewPlans === true
      ? addsWork
        ? "pending"
        : build.approval
      : build.approval === "pending"
        ? "not_needed"
        : build.approval;
  return accepted({
    ...build,
    spec: input.spec,
    acceptance: input.acceptance,
    tasks,
    ...unfinished(build),
    approval,
    updatedAt: now,
  });
};

/** What a changed plan or a lost commit takes back: the end of the build has to be earned again. */
const unfinished = (build: OzoneBuild) => ({
  finalEvidence: [],
  finalStartedAt: null,
  completedAt: null,
  // The count of verifiers stays: it names each hand-off.
  verification: { ...NO_OZONE_VERIFICATION, dispatches: build.verification.dispatches },
});

/** The person has seen the plan and wants it built. */
export const approved = (build: OzoneBuild, now: string): OzoneBuild =>
  build.approval === "pending" ? { ...build, approval: "approved", updatedAt: now } : build;

/**
 * The tasks to hand out now. Any number of read-only tasks may run together, or exactly one that
 * writes, never both: checks must judge a tree nobody else is changing.
 */
export const nextTasks = (build: OzoneBuild): ReadonlyArray<OzoneBuildTask> => {
  if (build.approval === "pending") return [];
  if (build.tasks.some((task) => task.status === "blocked")) return [];
  const active = build.tasks.filter(isActive);
  if (active.some((task) => task.access === "write")) return [];
  const settled = new Set(build.tasks.filter(isSettled).map((task) => task.id));
  const ready = build.tasks.filter(
    (task) => task.status === "pending" && task.dependsOn.every((id) => settled.has(id)),
  );
  const first = ready[0];
  if (first === undefined) return [];
  if (active.length === 0 && first.access === "write") return [first];
  return ready.filter((task) => task.access === "read");
};

const updateTask = (
  build: OzoneBuild,
  taskId: string,
  now: string,
  change: (task: OzoneBuildTask) => OzoneBuildTask,
): OzoneBuild => ({
  ...build,
  tasks: build.tasks.map((task) => (task.id === taskId ? change(task) : task)),
  updatedAt: now,
});

export const started = (
  build: OzoneBuild,
  taskId: string,
  worker: {
    readonly workerTaskId: NodeId;
    readonly workerThreadId: ThreadId | null;
    readonly baseSha: string | null;
  },
  now: string,
): OzoneBuild =>
  updateTask(build, taskId, now, (task) => ({
    ...task,
    ...worker,
    status: "running",
    attempts: task.attempts + 1,
    dispatches: task.dispatches + 1,
    blockedReason: null,
  }));

/** The worker has finished; its summary is kept so the checks can resume after a restart. */
export const checking = (
  build: OzoneBuild,
  taskId: string,
  summary: string | null,
  now: string,
): OzoneBuild =>
  updateTask(build, taskId, now, (task) => ({ ...task, status: "checking", summary }));

export const passed = (
  build: OzoneBuild,
  taskId: string,
  result: {
    readonly commitSha: string | null;
    readonly snapshotId: string | null;
    readonly evidence: ReadonlyArray<OzoneGateResult>;
    readonly summary: string | null;
  },
  now: string,
): OzoneBuild =>
  updateTask(build, taskId, now, (task) => ({
    ...task,
    ...result,
    status: "done",
    blockedReason: null,
  }));

/** A failed attempt goes back for repair until the attempts run out, then to the lead. */
export const failed = (
  build: OzoneBuild,
  taskId: string,
  result: {
    readonly evidence: ReadonlyArray<OzoneGateResult>;
    readonly summary: string | null;
    readonly reason: string;
  },
  now: string,
): OzoneBuild =>
  updateTask(build, taskId, now, (task) => {
    const exhausted = task.attempts >= build.maxAttempts;
    return {
      ...task,
      evidence: result.evidence,
      summary: result.summary,
      status: exhausted ? "blocked" : "pending",
      blockedReason: exhausted
        ? `${result.reason} It has been tried ${task.attempts} times.`
        : null,
    };
  });

/** For what another attempt cannot fix, such as a migration that drops data. */
export const blocked = (
  build: OzoneBuild,
  taskId: string,
  result: {
    readonly evidence: ReadonlyArray<OzoneGateResult>;
    readonly summary: string | null;
    readonly reason: string;
  },
  now: string,
): OzoneBuild =>
  updateTask(build, taskId, now, (task) => ({
    ...task,
    evidence: result.evidence,
    summary: result.summary,
    status: "blocked",
    blockedReason: result.reason,
  }));

/** The lead's ruling on a blocked task. `accept` leaves the committing to the conductor. */
export const resolved = (
  build: OzoneBuild,
  taskId: string,
  ruling: Exclude<OzoneBuildRuling, "accept">,
  now: string,
): Decision => {
  const task = build.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) return refused(`There is no task called ${taskId}.`);
  if (task.status !== "blocked") {
    return refused(
      `Task ${taskId} is ${task.status}, not blocked. Only a blocked task needs a ruling.`,
    );
  }
  return accepted(
    updateTask(build, taskId, now, (current) =>
      ruling === "skip"
        ? { ...current, status: "skipped", blockedReason: null }
        : { ...current, status: "pending", attempts: 0, blockedReason: null },
    ),
  );
};

/** Adds the lead's guidance to a task's evidence, where the next worker's brief reads it. */
export const guided = (build: OzoneBuild, taskId: string, note: string): OzoneBuild => ({
  ...build,
  tasks: build.tasks.map((task) =>
    task.id === taskId
      ? { ...task, evidence: [...task.evidence, { id: "lead", ok: false, detail: note }] }
      : task,
  ),
});

/**
 * Puts back tasks whose commits are gone from history, after a rollback or a reset. Each keeps
 * its commit, so a restore that brings that commit back can mark it done again.
 */
export const reopened = (
  build: OzoneBuild,
  taskIds: ReadonlyArray<string>,
  now: string,
): OzoneBuild => {
  if (taskIds.length === 0) return build;
  const lost = new Set(taskIds);
  return {
    ...build,
    tasks: build.tasks.map((task) =>
      lost.has(task.id)
        ? {
            ...task,
            status: "pending",
            attempts: 0,
            evidence: [],
            workerTaskId: null,
            workerThreadId: null,
          }
        : task,
    ),
    ...unfinished(build),
    updatedAt: now,
  };
};

/**
 * The plan after the app's code was restored to an earlier point: tasks whose work it undid go
 * back into the plan, and reopened tasks whose commits it brought back are done again.
 */
export const rewound = (
  build: OzoneBuild,
  change: { readonly undone: ReadonlyArray<string>; readonly redone: ReadonlyArray<string> },
  now: string,
): OzoneBuild => {
  const reopenedBuild = reopened(build, change.undone, now);
  if (change.redone.length === 0) return reopenedBuild;
  const back = new Set(change.redone);
  return {
    ...reopenedBuild,
    tasks: reopenedBuild.tasks.map((task) =>
      back.has(task.id) ? { ...task, status: "done" } : task,
    ),
    updatedAt: now,
  };
};

/** Marks the final check as running, so a restart in the middle of it runs it again. */
export const finalStarted = (build: OzoneBuild, now: string): OzoneBuild => ({
  ...build,
  // A failure it is checking again no longer stands while it runs.
  finalEvidence: [],
  finalStartedAt: now,
  updatedAt: now,
});

/**
 * The result of the checks that run once at the end. A build that passes them is complete, unless
 * it has criteria a verifier still has to try.
 */
export const finalChecked = (
  build: OzoneBuild,
  finalEvidence: ReadonlyArray<OzoneGateResult>,
  options: { readonly verify: boolean },
  now: string,
): OzoneBuild => {
  const passedAll = finalEvidence.every((gate) => gate.ok);
  const verify = passedAll && options.verify && build.acceptance.length > 0;
  return {
    ...build,
    finalEvidence,
    finalStartedAt: null,
    completedAt: passedAll && !verify ? now : null,
    verification: { ...build.verification, status: verify ? "pending" : "none" },
    updatedAt: now,
  };
};

/** True when every task is settled and the check that ends the build has not passed yet. */
export const awaitsFinalCheck = (build: OzoneBuild): boolean =>
  build.tasks.length > 0 &&
  build.tasks.every(isSettled) &&
  build.completedAt === null &&
  build.verification.status === "none";

export const verificationStarted = (
  build: OzoneBuild,
  verifier: { readonly workerTaskId: NodeId; readonly workerThreadId: ThreadId | null },
  now: string,
): OzoneBuild => ({
  ...build,
  verification: {
    ...build.verification,
    ...verifier,
    status: "running",
    dispatches: build.verification.dispatches + 1,
    results: [],
    note: null,
  },
  updatedAt: now,
});

/**
 * What the tester found. One failed criterion stops the build for the lead. A tester that could
 * try nothing is said, and does not hold the build: it proves nothing either way.
 */
export const verified = (
  build: OzoneBuild,
  results: ReadonlyArray<OzoneCriterionResult>,
  note: string | null,
  now: string,
): OzoneBuild => {
  // A plan revised in the meantime has already put this tester's findings aside.
  if (build.verification.status !== "running") return build;
  const status = results.some((result) => result.verdict === "fail")
    ? "failed"
    : results.some((result) => result.verdict === "pass")
      ? "passed"
      : "unavailable";
  return {
    ...build,
    verification: { ...build.verification, status, results, note },
    completedAt: status === "failed" ? null : now,
    updatedAt: now,
  };
};

/** The lead's ruling on what the tester found: try the app again, or keep the build and say why. */
export const verificationRuled = (
  build: OzoneBuild,
  ruling: OzoneBuildRuling,
  note: string | undefined,
  now: string,
): Decision => {
  if (build.verification.status !== "failed") {
    return refused("The tester has not found a failure, so there is nothing to rule on.");
  }
  if (ruling === "skip") return refused("Rule on the tester's findings with `retry` or `accept`.");
  if (ruling === "retry") {
    return accepted({
      ...build,
      verification: { ...build.verification, status: "pending" },
      updatedAt: now,
    });
  }
  if (note === undefined) return refused("Say in `note` why the build is kept as it is.");
  return accepted({
    ...build,
    verification: { ...build.verification, status: "accepted", note },
    completedAt: now,
    updatedAt: now,
  });
};
