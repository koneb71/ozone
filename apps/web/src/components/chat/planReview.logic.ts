import type { TimelineEntry } from "../../session-logic";
import type { ProposedPlan } from "../../types";

/** What the person can say to a plan that waits for them. */
export type PlanAnswer = "approve" | "keep" | "decline";

/** A plan that waits: a plan card, or a plan the agent only wrote as a message. */
export interface AwaitedPlan {
  readonly id: string;
  readonly planMarkdown: string;
  readonly kind: "card" | "written";
}

/**
 * The plan card that waits for the person's answer: the last one proposed since their last
 * message, while it is still the active plan. Their next message, whatever it says, answers it.
 */
export function planAwaitingAnswer(entries: ReadonlyArray<TimelineEntry>): AwaitedPlan | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.kind === "message" && entry.message.role === "user") return null;
    if (entry.kind === "proposed-plan") {
      // Approving marks it completed, and a newer plan supersedes it: neither waits any more.
      return entry.proposedPlan.status === "active"
        ? {
            id: entry.proposedPlan.id,
            planMarkdown: entry.proposedPlan.planMarkdown,
            kind: "card",
          }
        : null;
    }
  }
  return null;
}

/**
 * A plan written as an ordinary message. A provider whose plan mode files no plan card, such as
 * OpenCode, leaves its plan this way: its last message since the person's.
 */
export function writtenPlanAwaitingAnswer(
  entries: ReadonlyArray<TimelineEntry>,
): AwaitedPlan | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== "message") continue;
    if (entry.message.role === "user") return null;
    if (entry.message.role === "assistant") {
      return { id: entry.message.id, planMarkdown: entry.message.text, kind: "written" };
    }
  }
  return null;
}

/**
 * The plan the person is asked about. A plan card always counts. A written plan counts only where
 * the caller says so: an app's lead in plan mode with no question pending.
 */
export function planToAnswer(
  entries: ReadonlyArray<TimelineEntry>,
  writtenPlanCounts: boolean,
): AwaitedPlan | null {
  return (
    planAwaitingAnswer(entries) ?? (writtenPlanCounts ? writtenPlanAwaitingAnswer(entries) : null)
  );
}

/** What a plan card shows under the plan: the buttons, what became of it, or nothing. */
export function planCardFooter(input: {
  readonly status: ProposedPlan["status"];
  /** This is the plan the person is being asked about right now. */
  readonly awaited: boolean;
}): "answer" | "approved" | "replaced" | null {
  if (input.status === "completed") return "approved";
  if (input.status === "superseded") return "replaced";
  return input.awaited ? "answer" : null;
}
