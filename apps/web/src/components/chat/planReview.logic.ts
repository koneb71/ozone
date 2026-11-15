import type { TimelineEntry } from "../../session-logic";

/**
 * The plan that waits for the person's answer: the last one proposed since their last message.
 * Their next message, whatever it says, answers it.
 */
export function planAwaitingAnswer(
  entries: ReadonlyArray<TimelineEntry>,
): { readonly id: string; readonly planMarkdown: string } | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.kind === "message" && entry.message.role === "user") return null;
    if (entry.kind === "proposed-plan") {
      return { id: entry.proposedPlan.id, planMarkdown: entry.proposedPlan.planMarkdown };
    }
  }
  return null;
}

/**
 * A plan written as an ordinary message. An agent in plan mode that has no plan card to file,
 * such as one without Ozone's build tools, leaves its plan this way: its last message since the
 * person's.
 */
export function writtenPlanAwaitingAnswer(
  entries: ReadonlyArray<TimelineEntry>,
): { readonly id: string; readonly planMarkdown: string } | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== "message") continue;
    if (entry.message.role === "user") return null;
    if (entry.message.role === "assistant") {
      return { id: entry.message.id, planMarkdown: entry.message.text };
    }
  }
  return null;
}
