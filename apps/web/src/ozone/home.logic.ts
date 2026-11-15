const REQUEST =
  /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:build|create|make|design|develop|generate|write|i\s+(?:want|need)|we\s+(?:want|need))\s+(?:me\s+|us\s+)?/i;
const ARTICLE = /^(?:an?|the|some|my|our)\s+/i;
const DETAILS = /\s+(?:with|that|which|where|for|to|so|using|and|in|on|like)\s+.*$/i;
const GENERIC = new Set(["app", "application", "web app", "website", "site", "tool", "page"]);

/** A short name for a new app, taken from the first thing the user asked for. */
export function appNameFromPrompt(prompt: string): string {
  const request = (prompt.trim().split(/[\n.!?;:,(]/, 1)[0] ?? "")
    .replace(REQUEST, "")
    .replace(ARTICLE, "")
    .replace(/\s+/g, " ")
    .trim();
  const subject = request.replace(DETAILS, "");
  // "an app to split bills" names itself by what it does, not by the word "app".
  const named = GENERIC.has(subject.toLowerCase()) ? request : subject;
  const name = named.split(" ").slice(0, 4).join(" ").slice(0, 40).trim();
  return name.length === 0 ? "New app" : name.charAt(0).toUpperCase() + name.slice(1);
}

export const PLAN_FIRST_REQUEST =
  "Show me the plan first. Call ozone_build_plan and wait for me to start it; do not write code yet.";

const PLAN_FIRST_SUFFIX = `\n\n${PLAN_FIRST_REQUEST}`;

/**
 * How a message to an app's lead goes out when the user asked to see the plan first: a build's
 * first message, and every request after it. A provider with a plan mode runs the turn in it, so
 * the lead cannot change anything while it plans. One without is asked to file a plan with
 * Ozone's build tools, where it waits on the build card.
 */
export function planFirstMessage(input: {
  readonly prompt: string;
  readonly reviewPlans: boolean;
  readonly hasPlanMode: boolean;
}): { readonly text: string; readonly interactionMode: "default" | "plan" } {
  const { prompt } = input;
  if (!input.reviewPlans) return { text: prompt, interactionMode: "default" };
  if (input.hasPlanMode) return { text: prompt, interactionMode: "plan" };
  return {
    // A draft Home prepared already carries it.
    text: prompt.endsWith(PLAN_FIRST_SUFFIX) ? prompt : `${prompt}${PLAN_FIRST_SUFFIX}`,
    interactionMode: "default",
  };
}

/** A sent message without the Plan first request Ozone added, which the thread shows as a tag. */
export function splitPlanFirstRequest(text: string): {
  readonly text: string;
  readonly planFirst: boolean;
} {
  return text.endsWith(PLAN_FIRST_SUFFIX)
    ? { text: text.slice(0, -PLAN_FIRST_SUFFIX.length), planFirst: true }
    : { text, planFirst: false };
}
