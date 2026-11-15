import { assert, describe, it } from "@effect/vitest";
import {
  NO_OZONE_VERIFICATION,
  NodeId,
  ProjectId,
  ThreadId,
  type OzoneBuild,
  type OzoneBuildPlanInput,
  type OzoneBuildTask,
} from "@t3tools/contracts";

import * as BuildModel from "./BuildModel.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T01:00:00.000Z";
const NO_VERIFY = { verify: false };

type TaskPlan = OzoneBuildPlanInput["tasks"][number];
const task = (id: string, extra: Partial<TaskPlan> = {}): TaskPlan => ({
  id,
  title: `Task ${id}`,
  brief: `Do ${id}.`,
  ...extra,
});
const plan = (...tasks: ReadonlyArray<TaskPlan>): OzoneBuildPlanInput => ({
  spec: "A habit tracker.",
  acceptance: ["A habit can be added."],
  tasks,
});

const planned = (...tasks: ReadonlyArray<TaskPlan>): OzoneBuild => {
  const decision = BuildModel.applyPlan(
    BuildModel.emptyBuild(ThreadId.make("lead"), ProjectId.make("project"), NOW),
    plan(...tasks),
    NOW,
  );
  if (!decision.ok) throw new Error(decision.problems.join(" "));
  return decision.build;
};

const worker = (id: string) => ({
  workerTaskId: NodeId.make(`worker-${id}`),
  workerThreadId: ThreadId.make(`thread-${id}`),
  baseSha: "base",
});
const pass = (build: OzoneBuild, id: string): OzoneBuild =>
  BuildModel.passed(
    BuildModel.started(build, id, worker(id), NOW),
    id,
    { commitSha: `commit-${id}`, snapshotId: null, evidence: [], summary: `${id} done` },
    NOW,
  );
const fail = (build: OzoneBuild, id: string): OzoneBuild =>
  BuildModel.failed(
    BuildModel.started(build, id, worker(id), NOW),
    id,
    {
      evidence: [{ id: "typecheck", ok: false, detail: "TS2322" }],
      summary: null,
      reason: "It failed typecheck.",
    },
    NOW,
  );
const find = (build: OzoneBuild, id: string): OzoneBuildTask => {
  const found = build.tasks.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no task ${id}`);
  return found;
};
const ready = (build: OzoneBuild) => BuildModel.nextTasks(build).map((next) => next.id);

describe("BuildModel", () => {
  it.each<readonly [string, ReadonlyArray<TaskPlan>, RegExp]>([
    ["a duplicate id", [task("a"), task("a")], /Two tasks are called a/],
    [
      "an unknown dependency",
      [task("a", { dependsOn: ["z"] })],
      /depends on z, which is not in the plan/,
    ],
    ["a task that waits on itself", [task("a", { dependsOn: ["a"] })], /depends on itself/],
    [
      "a cycle",
      [
        task("a", { dependsOn: ["c"] }),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["b"] }),
      ],
      /wait on each other: a → c → b → a/,
    ],
  ])("refuses a plan with %s", (_name, tasks, problem) => {
    assert.match(BuildModel.planProblems(tasks).join(" "), problem);
  });

  it("accepts a diamond, which is not a cycle", () => {
    assert.deepStrictEqual(
      BuildModel.planProblems([
        task("schema"),
        task("api", { dependsOn: ["schema"] }),
        task("page", { dependsOn: ["schema"] }),
        task("polish", { dependsOn: ["api", "page"] }),
      ]),
      [],
    );
  });

  it("hands out tasks in plan order as their dependencies settle", () => {
    let build = planned(
      task("schema"),
      task("page", { dependsOn: ["schema"] }),
      task("chart", { dependsOn: ["page"] }),
    );
    assert.strictEqual(BuildModel.statusOf(build), "building");
    assert.deepStrictEqual(ready(build), ["schema"]);
    build = BuildModel.started(build, "schema", worker("schema"), NOW);
    // One writer at a time: nothing else starts while it works or is being checked.
    assert.deepStrictEqual(ready(build), []);
    build = BuildModel.checking(build, "schema", "schema done", NOW);
    assert.deepStrictEqual(ready(build), []);
    build = pass(planned(task("schema"), task("page", { dependsOn: ["schema"] })), "schema");
    assert.deepStrictEqual(ready(build), ["page"]);
  });

  it("runs read-only tasks together, and never beside a writer", () => {
    const independent = [
      task("research", { access: "read" }),
      task("review", { access: "read" }),
      task("schema"),
    ] as const;
    let build = planned(...independent);
    // The first ready task reads, so every ready reader goes and the writer waits.
    assert.deepStrictEqual(ready(build), ["research", "review"]);
    build = BuildModel.started(build, "research", worker("research"), NOW);
    assert.deepStrictEqual(ready(build), ["review"]);
    build = pass(pass(planned(...independent), "research"), "review");
    assert.deepStrictEqual(ready(build), ["schema"]);

    // The first ready task writes, so it goes alone and the readers wait.
    build = planned(task("schema"), task("research", { access: "read" }));
    assert.deepStrictEqual(ready(build), ["schema"]);
    build = BuildModel.started(build, "schema", worker("schema"), NOW);
    assert.deepStrictEqual(ready(build), []);
  });

  it("sends a failed task back for repair until the attempts run out", () => {
    let build = planned(task("page"), task("chart", { dependsOn: ["page"] }));
    build = fail(build, "page");
    assert.include(find(build, "page"), { status: "pending", attempts: 1, blockedReason: null });
    // The evidence stays with the task, for the next worker's brief.
    assert.deepStrictEqual(find(build, "page").evidence, [
      { id: "typecheck", ok: false, detail: "TS2322" },
    ]);
    assert.deepStrictEqual(ready(build), ["page"]);

    build = fail(fail(build, "page"), "page");
    assert.strictEqual(find(build, "page").status, "blocked");
    assert.strictEqual(
      find(build, "page").blockedReason,
      "It failed typecheck. It has been tried 3 times.",
    );
    assert.strictEqual(BuildModel.statusOf(build), "blocked");
    // A blocked task stops the line until the lead rules on it.
    assert.deepStrictEqual(ready(build), []);
  });

  it("applies the lead's ruling to a blocked task only", () => {
    const stuck = fail(fail(fail(planned(task("page"), task("chart")), "page"), "page"), "page");

    const retried = BuildModel.resolved(stuck, "page", "retry", LATER);
    assert.isTrue(retried.ok);
    if (retried.ok) {
      // Attempts start over; the count of hand-offs does not, so the next worker is a new one.
      assert.include(find(retried.build, "page"), {
        status: "pending",
        attempts: 0,
        dispatches: 3,
      });
      assert.deepStrictEqual(ready(retried.build), ["page"]);
    }
    const skipped = BuildModel.resolved(stuck, "page", "skip", LATER);
    if (skipped.ok) {
      assert.strictEqual(find(skipped.build, "page").status, "skipped");
      // A skipped task no longer holds back what waited on it.
      assert.deepStrictEqual(ready(skipped.build), ["chart"]);
    }
    assert.deepStrictEqual(BuildModel.resolved(stuck, "chart", "skip", LATER), {
      ok: false,
      problems: ["Task chart is pending, not blocked. Only a blocked task needs a ruling."],
    });
    assert.deepStrictEqual(BuildModel.resolved(stuck, "nope", "retry", LATER), {
      ok: false,
      problems: ["There is no task called nope."],
    });
  });

  it("blocks at once on what a retry cannot fix", () => {
    const build = BuildModel.blocked(
      BuildModel.started(planned(task("schema")), "schema", worker("schema"), NOW),
      "schema",
      { evidence: [], summary: null, reason: "A migration drops the habits table." },
      NOW,
    );
    assert.include(find(build, "schema"), {
      status: "blocked",
      attempts: 1,
      blockedReason: "A migration drops the habits table.",
    });
  });

  it("keeps finished work when the plan is revised", () => {
    const first = pass(planned(task("schema"), task("page", { dependsOn: ["schema"] })), "schema");
    const revised = BuildModel.applyPlan(
      first,
      plan(
        task("schema"),
        task("page", { dependsOn: ["schema"], brief: "Do page, with filters." }),
        task("chart", { dependsOn: ["page"] }),
      ),
      LATER,
    );
    assert.isTrue(revised.ok);
    if (!revised.ok) return;
    assert.include(find(revised.build, "schema"), { status: "done", commitSha: "commit-schema" });
    assert.include(find(revised.build, "page"), {
      status: "pending",
      brief: "Do page, with filters.",
    });
    assert.deepStrictEqual(
      revised.build.tasks.map((entry) => entry.id),
      ["schema", "page", "chart"],
    );

    const rewritesDone = BuildModel.applyPlan(
      first,
      plan(task("schema", { brief: "Other." })),
      LATER,
    );
    assert.deepStrictEqual(rewritesDone, {
      ok: false,
      problems: [
        "Task schema is already done and cannot be rewritten. Add a new task for the change.",
      ],
    });
    const dropsDone = BuildModel.applyPlan(first, plan(task("page")), LATER);
    assert.deepStrictEqual(dropsDone, {
      ok: false,
      problems: ["Task schema is already done. Keep it in the plan; add new tasks after it."],
    });
    const running = BuildModel.started(first, "page", worker("page"), NOW);
    const rewritesRunning = BuildModel.applyPlan(
      running,
      plan(task("schema"), task("page", { dependsOn: ["schema"], brief: "Changed." })),
      LATER,
    );
    assert.deepStrictEqual(rewritesRunning, {
      ok: false,
      problems: ["Task page is running and cannot be rewritten until it finishes."],
    });
  });

  it("reopens tasks whose commits left the history, and the build with them", () => {
    let build = pass(pass(planned(task("schema"), task("page")), "schema"), "page");
    build = BuildModel.finalChecked(build, [{ id: "build", ok: true, detail: "" }], NO_VERIFY, NOW);
    assert.strictEqual(BuildModel.statusOf(build), "complete");

    build = BuildModel.reopened(build, ["page"], LATER);
    // The commit stays known, so a restore that brings it back can mark the task done again.
    assert.include(find(build, "page"), {
      status: "pending",
      attempts: 0,
      commitSha: "commit-page",
    });
    assert.strictEqual(find(build, "schema").status, "done");
    assert.strictEqual(BuildModel.statusOf(build), "building");
    assert.strictEqual(build.completedAt, null);
  });

  it("is complete only when the final checks pass", () => {
    const allDone = pass(planned(task("schema")), "schema");
    assert.strictEqual(BuildModel.statusOf(allDone), "building");
    const broken = BuildModel.finalChecked(
      allDone,
      [{ id: "build", ok: false, detail: "error" }],
      NO_VERIFY,
      NOW,
    );
    assert.strictEqual(BuildModel.statusOf(broken), "blocked");
    assert.strictEqual(broken.completedAt, null);
    // A new task for the fix puts the build back to work and clears the stale verdict.
    const fixing = BuildModel.applyPlan(broken, plan(task("schema"), task("fix-build")), LATER);
    assert.isTrue(fixing.ok && BuildModel.statusOf(fixing.build) === "building");
    assert.isTrue(fixing.ok && fixing.build.finalEvidence.length === 0);
    assert.strictEqual(
      BuildModel.statusOf(BuildModel.finalChecked(allDone, [], NO_VERIFY, NOW)),
      "complete",
    );
  });

  it("holds a reviewed plan until the person approves it, and again when work is added", () => {
    const empty = BuildModel.emptyBuild(ThreadId.make("lead"), ProjectId.make("project"), NOW);
    const decision = BuildModel.applyPlan(empty, plan(task("schema")), NOW, { reviewPlans: true });
    if (!decision.ok) return assert.fail(decision.problems.join(" "));
    assert.strictEqual(BuildModel.statusOf(decision.build), "review");
    assert.deepStrictEqual(BuildModel.nextTasks(decision.build), []);

    const approved = BuildModel.approved(decision.build, LATER);
    assert.strictEqual(BuildModel.statusOf(approved), "building");
    assert.deepStrictEqual(
      BuildModel.nextTasks(approved).map((ready) => ready.id),
      ["schema"],
    );
    const running = BuildModel.started(approved, "schema", worker("schema"), LATER);
    const revise = (reviewPlans: boolean, ...tasks: ReadonlyArray<ReturnType<typeof task>>) => {
      const revised = BuildModel.applyPlan(running, plan(...tasks), LATER, { reviewPlans });
      return revised.ok ? revised.build.approval : revised.problems.join(" ");
    };
    // Saving the same plan again changes nothing the person approved.
    assert.strictEqual(revise(true, task("schema")), "approved");
    // New work was never seen, so it waits, however far the build has come.
    assert.strictEqual(revise(true, task("schema"), task("page")), "pending");
    // With the setting off, a revision runs without asking, as it always did.
    assert.strictEqual(revise(false, task("schema"), task("page")), "approved");
  });

  it("has a tester try the app after the final check, and the lead rule on what it finds", () => {
    const allDone = pass(planned(task("page")), "page");
    const checked = BuildModel.finalChecked(allDone, [], { verify: true }, NOW);
    assert.strictEqual(checked.verification.status, "pending");
    assert.strictEqual(checked.completedAt, null);
    assert.strictEqual(BuildModel.statusOf(checked), "building");
    assert.isFalse(BuildModel.awaitsFinalCheck(checked));

    const tester = { workerTaskId: NodeId.make("tester"), workerThreadId: null };
    const trying = BuildModel.verificationStarted(checked, tester, NOW);
    const fails = [
      { criterion: "A habit can be added.", verdict: "fail" as const, note: "No form." },
    ];
    const failed = BuildModel.verified(trying, fails, null, NOW);
    assert.strictEqual(BuildModel.statusOf(failed), "blocked");

    const unexplained = BuildModel.verificationRuled(failed, "accept", undefined, LATER);
    assert.isFalse(unexplained.ok);
    const kept = BuildModel.verificationRuled(failed, "accept", "The form is on /new.", LATER);
    assert.isTrue(kept.ok && BuildModel.statusOf(kept.build) === "complete");
    const again = BuildModel.verificationRuled(failed, "retry", undefined, LATER);
    assert.isTrue(again.ok && again.build.verification.status === "pending");

    // A tester that could try nothing does not hold the build, and says so.
    const unchecked = [
      { criterion: "A habit can be added.", verdict: "unchecked" as const, note: "" },
    ];
    const blind = BuildModel.verified(trying, unchecked, "no browser", NOW);
    assert.strictEqual(blind.verification.status, "unavailable");
    assert.strictEqual(BuildModel.statusOf(blind), "complete");

    // A fix task puts the end of the build back to be earned, tester included.
    const fixing = BuildModel.applyPlan(failed, plan(task("page"), task("form")), LATER);
    if (!fixing.ok) return assert.fail(fixing.problems.join(" "));
    assert.deepStrictEqual(fixing.build.verification, {
      ...NO_OZONE_VERIFICATION,
      dispatches: 1,
    });
    // A tester still out when the plan changed reports into nothing.
    assert.strictEqual(BuildModel.verified(fixing.build, fails, null, LATER), fixing.build);
  });
});
