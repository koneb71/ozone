# The Build Conductor

Upstream gives an agent `delegate_task`: a durable child thread on any provider. It gives no plan,
no checks, no retries and no limits above that. The conductor is that missing structure. It lives
in [`apps/server/src/ozone/builds`](../../apps/server/src/ozone/builds) and is made only from
upstream's public services, so upstream's orchestration core is not edited at all.

One build belongs to one lead thread. The lead writes the plan with `ozone_build_plan` and calls
`ozone_build_advance`; the server does everything else.

## The step

`advance` first settles what happened since the last call, then takes the next step, and repeats
until it runs out of work or of patience:

1. Tasks whose commits are gone from history, after a rollback or reset, go back into the plan.
2. Each running task is read from its worker. A finished one is checked. A worker that asked a
   question hands the step back to the lead.
3. The next tasks are handed out: any number that only read, or exactly one that writes.
4. When every task has passed, the manifest's `final` gates run once.
5. When those pass and the plan has acceptance criteria, a tester uses the app in a browser.

Every call may be the first after a crash, so nothing in it assumes the previous call finished.

## Decisions

**The server runs the checks.** A worker's claim that its work passes is never used.
[`BuildGates`](../../apps/server/src/ozone/builds/BuildGates.ts) runs the manifest's gates inside
the app's container and probes that the app still answers.

**Repair goes to a fresh worker.** It gets the failed checks' output and the last worker's summary.
A follow-up in the same thread would carry the reasoning that produced the failure, and upstream
would wake the lead for it a second time.

**One writer, or many readers.** Checks must judge a tree nobody else is changing, and the preview
must not show half of two changes. A read-only task that changed files fails, and its changes are
set aside with `git stash`, not deleted.

**A worker is tracked by its task id, not by a request key.** Upstream makes a repeated
`delegate_task` the same work only within one provider session, because its command id is
namespaced by that session. A lead that reconnects would start a second worker. So a task is
dispatched without waiting, its id is stored at once, and every later call reads that id. The
request key carries `dispatches`, a count that never goes down, so a retry after a ruling is a new
worker.

**Reading a finished worker acknowledges it.** Upstream wakes the parent when an async task ends.
`taskStatus` acknowledges the result, so a step that saw the worker finish does not also get a wake.
A step that ran out of patience returns, and that wake is what brings the lead back.

**A step is short, and never outlives its lead's turn on purpose.** Claude Code moves a tool call
to the background after two minutes, and the lead's turn can then end while the step still runs.
Upstream starts a worker only for a lead whose turn is running, so a step that went on would fail
at its next hand-off. A step therefore waits for at most 75 seconds (40 for harnesses that give up
on a call within a minute), starts no more workers once that time is spent, and returns. The wake
that follows a finished worker brings the lead back. Correctness never depends on one long call.

**Checks are jobs of the server, not of the call that asked for them.** A type check, a test suite
or a production build can take longer than a step waits.
[`BuildChecks`](../../apps/server/src/ozone/builds/BuildChecks.ts) runs each one as a job that
outlives the step: the step waits for it as long as its patience lasts, then tells the lead to end
its turn. The job saves its result and, only if no step is waiting for it any more, wakes the lead
with a message in its thread. Whether a step is waiting and whether the job is done are read and
written in one synchronous block each, so exactly one of the two tells the lead. A check a restart
cut short is found in the store when the server starts, run again, and its lead woken.

**Every write is a read-modify-write.** A job and a tool call can save the same build at the same
moment. The store changes a build in one step under a lock, and a job saves its result only if the
task is still where it left it: a plan revised in the meantime wins.

**A tester uses the finished app.** Every gate can pass on an app that does not do what was asked.
When the final check passes, a read-only worker opens the app in the preview browser, tries each
acceptance criterion as a person would, and ends with one verdict line per criterion. A failure
stops the build for the lead, which adds a fix task, has the app tried again, or keeps the build and
says why. A tester that could try nothing, for want of a browser, does not hold the build; the
report says so. Its brief and the parser of its verdicts are in
[`verification.ts`](../../apps/server/src/ozone/builds/verification.ts).

**A plan can wait for the person.** With the app's "Show me the plan" setting, a first plan runs
nothing until the person starts it from the build card, which wakes the lead, or the lead passes
`approved` after the person said so in the chat. A revision of a plan that has started is not
reviewed again: it adds to what the person already approved.

**Workers can run on another model.** The lead keeps the model of its thread. Each app can name a
model for its workers and tester, which is passed to upstream's `delegate_task` as its target.

**A failed check reaches the next reader with both ends of its output.** A bundler prints its error
first and a stack after it; a test runner ends with its summary. Evidence keeps the head and the
tail. When the final check fails, the lead gets that output with the status, and
`ozone_build_check` runs the final check too, so it cannot answer "every check passes" for a build
that is still stopped.

**A migration that can lose data needs a person.** Another attempt cannot decide it, so the task is
blocked at once instead of retried, and the lead's accept is refused until the person has applied
the migration from the app's banner. See [data safety](./data-safety.md).

**Each passed task is a commit and a data snapshot.** A code rollback and a data restore line up,
and the worst an agent can do to the data is one task's worth.

**The protocol reaches agents through the app's `AGENTS.md`.** Every provider loads that file
itself and it survives compaction, so no provider adapter is edited. The tools are hidden from
workers, and a worker's brief starts with `Ozone task`, which that file keys on.

## Traps

- Ozone's tools are registered beside upstream's `layerTools`, not in it: a test upstream pins that
  set's size against the agent's context budget.
- The conductor is built inside the MCP server's layers, not in `Ozone.layer`. The delegation
  service it drives only exists there. The checks are in `Ozone.layer`, because their jobs must
  outlive any one call and resume when the server starts.
- An MCP tool without parameters must omit `parameters`. An empty struct is rejected when the server
  starts, which no type check sees; `mcp/tools.test.ts` registers every tool for that reason.
- The text of briefs and `next` lines is in [`briefs.ts`](../../apps/server/src/ozone/builds/briefs.ts).
  It is model-facing: an agent follows it literally.

## Not built yet

- Writers in parallel worktrees with a merge queue, and cost budgets.
- Ozone's instructions, briefs and tool descriptions have no eval cases. They were tried on real
  builds with Claude Haiku as lead and worker.
