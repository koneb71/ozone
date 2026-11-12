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
