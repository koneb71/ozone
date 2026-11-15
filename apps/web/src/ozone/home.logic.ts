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

/**
 * How a build's first message goes out when the user asked to see the plan first. A lead with
 * Ozone's build tools files a plan that waits for the user. One without them cannot, so it starts
 * in the provider's own plan mode, and a provider with neither cannot honour the request.
 */
export function buildKickoff(input: {
  readonly prompt: string;
  readonly reviewPlans: boolean;
  readonly provider: {
    readonly displayName: string;
    readonly supportsBuildTools: boolean;
    readonly hasPlanMode: boolean;
  };
}):
  | { readonly kind: "start"; readonly text: string; readonly interactionMode: "default" | "plan" }
  | { readonly kind: "refuse"; readonly message: string } {
  const { prompt, provider } = input;
  if (!input.reviewPlans) return { kind: "start", text: prompt, interactionMode: "default" };
  if (provider.supportsBuildTools) {
    return {
      kind: "start",
      text: `${prompt}\n\n${PLAN_FIRST_REQUEST}`,
      interactionMode: "default",
    };
  }
  if (provider.hasPlanMode) return { kind: "start", text: prompt, interactionMode: "plan" };
  return {
    kind: "refuse",
    message: `${provider.displayName} cannot show a plan before it builds. Turn Plan first off, or pick another model.`,
  };
}
