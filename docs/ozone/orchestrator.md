# The Build Conductor

Upstream gives an agent `delegate_task`: a durable child thread on any provider. It gives no plan,
no checks, no retries and no limits above that. The conductor is that missing structure. It lives
in [`apps/server/src/ozone/build`](../../apps/server/src/ozone/build) and is made only from
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

Every call may be the first after a crash, so nothing in it assumes the previous call finished.

## Decisions

**The server runs the checks.** A worker's claim that its work passes is never used.
[`BuildGates`](../../apps/server/src/ozone/build/BuildGates.ts) runs the manifest's gates inside
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

**Patience depends on the provider.** Claude and Codex are configured upstream to let a tool call
run for an hour, so a step waits up to eight minutes. Other providers give up within a minute, so
a step waits forty seconds and relies on the wake. Correctness never depends on one long call.

**A migration that can lose data needs a person.** Another attempt cannot decide it, so the task is
blocked at once instead of retried. See [data safety](./data-safety.md).

**Each passed task is a commit and a data snapshot.** A code rollback and a data restore line up,
and the worst an agent can do to the data is one task's worth.

**The protocol reaches agents through the app's `AGENTS.md`.** Every provider loads that file
itself and it survives compaction, so no provider adapter is edited. The tools are hidden from
workers, and a worker's brief starts with `Ozone task`, which that file keys on.

## Traps

- Ozone's tools are registered beside upstream's `layerTools`, not in it: a test upstream pins that
  set's size against the agent's context budget.
- The conductor is built inside the MCP server's layers, not in `Ozone.layer`. The delegation
  service it drives only exists there.
- An MCP tool without parameters must omit `parameters`. An empty struct is rejected when the server
  starts, which no type check sees; `mcp/tools.test.ts` registers every tool for that reason.
- The text of briefs and `next` lines is in [`briefs.ts`](../../apps/server/src/ozone/build/briefs.ts).
  It is model-facing: an agent follows it literally.

## Not built yet

An independent verifier that checks the acceptance criteria in the preview browser, writers in
parallel worktrees with a merge queue, and cost budgets.
