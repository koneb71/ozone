import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const THREAD_LINK_PROTOCOL = "t3-thread";
const V1_PREFIX = `${THREAD_LINK_PROTOCOL}://v1/`;
const V2_PREFIX = `${THREAD_LINK_PROTOCOL}://v2/`;
const APP_SEGMENT = "[A-Za-z0-9_%-]+";

/** `<origin>/threads/` for the app the links were copied from, or null when there is none to match. */
function appThreadPrefix(appOrigin: string | undefined): string | null {
  if (appOrigin === undefined || !URL.canParse(appOrigin)) return null;
  return `${new URL(appOrigin).origin}/threads/`;
}

const patterns = new Map<string | null, RegExp>();

// Code comes first in the alternation so a link written inside a code span or fence is skipped.
// A labeled link's destination may be angle-bracketed, as CommonMark allows: [label](<href>).
function threadLinkOutsideCode(appPrefix: string | null): RegExp {
  let pattern = patterns.get(appPrefix);
  if (pattern === undefined) {
    const appLink =
      appPrefix === null
        ? null
        : `${appPrefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}${APP_SEGMENT}/${APP_SEGMENT}`;
    const or = appLink === null ? "" : `|${appLink}`;
    const bare = appLink === null ? "" : String.raw`|(?<bare>${appLink})(?![\w%/?#-])`;
    pattern = new RegExp(
      String.raw`(?<fence>(\`{3,}|~{3,})[\s\S]*?(?:\2|$))|(?<span>(\`+)[^\n]*?\4)|\[(?<label>[^\]\n]*)\]\((?:<(?<angleHref>t3-thread:\/\/v[12]\/[^\s<>]+${or})>|(?<href>t3-thread:\/\/v[12]\/[^\s>)]+${or}))\)|<(?<autolink>t3-thread:\/\/v[12]\/[^\s<>]+${or})>${bare}`,
      "g",
    );
    patterns.set(appPrefix, pattern);
  }
  return new RegExp(pattern);
}

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);

/** A v1 link names no environment; the message's own, or a unique match, stands in. */
export interface ThreadLink {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId;
}

// Escapes even URL-safe punctuation, so a sentence's closing period never reads as part of an id.
const appSegment = (id: string) =>
  encodeURIComponent(id).replace(
    /[.!~*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Opens the thread in the app served at `origin`. */
export function appThreadLink(ref: ScopedThreadRef, origin: string): string {
  const path = `/threads/${appSegment(ref.environmentId)}/${appSegment(ref.threadId)}`;
  return new URL(path, origin).toString();
}

const APP_PATH = new RegExp(`^(${APP_SEGMENT})/(${APP_SEGMENT})$`);

function parseAppThreadLink(path: string): ThreadLink | null {
  const match = APP_PATH.exec(path);
  if (!match) return null;
  try {
    const environmentId = Option.getOrNull(decodeEnvironmentId(decodeURIComponent(match[1]!)));
    const threadId = Option.getOrNull(decodeThreadId(decodeURIComponent(match[2]!)));
    return environmentId === null || threadId === null ? null : { environmentId, threadId };
  } catch {
    return null;
  }
}

/**
 * The ids as written. Thread ids can hold percent escapes of their own, so they are not decoded,
 * except in a link to the app at `appOrigin`, which escapes them itself. Without `appOrigin`
 * only `t3-thread:` links are recognised.
 */
export function parseThreadLinkHref(href: string, appOrigin?: string): ThreadLink | null {
  const appPrefix = appThreadPrefix(appOrigin);
  if (appPrefix !== null && href.startsWith(appPrefix)) {
    return parseAppThreadLink(href.slice(appPrefix.length));
  }
  if (href.startsWith(V1_PREFIX)) {
    const threadId = Option.getOrNull(decodeThreadId(href.slice(V1_PREFIX.length)));
    return threadId === null ? null : { environmentId: null, threadId };
  }
  if (!href.startsWith(V2_PREFIX)) return null;
  const path = href.slice(V2_PREFIX.length);
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  const environmentId = Option.getOrNull(decodeEnvironmentId(path.slice(0, slash)));
  const threadId = Option.getOrNull(decodeThreadId(path.slice(slash + 1)));
  return environmentId === null || threadId === null ? null : { environmentId, threadId };
}

function percentDecodedThreadLinkId(threadId: ThreadId): ThreadId | null {
  try {
    const decoded = decodeURIComponent(threadId);
    return decoded === threadId ? null : Option.getOrNull(decodeThreadId(decoded));
  } catch {
    return null;
  }
}

/** The threads a link can name, in its own environment or else the message's: as written, then decoded. */
export function threadLinkCandidates(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  const environmentId = link.environmentId ?? messageEnvironmentId;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  const written = { environmentId, threadId: link.threadId };
  return decodedId === null ? [written] : [written, { environmentId, threadId: decodedId }];
}

/** A v1 link its message's environment lacks opens a unique match elsewhere; a v2 link never does. */
export function guessThreadLinkRef(
  link: ThreadLink,
  refs: ReadonlyArray<ScopedThreadRef>,
): ScopedThreadRef | null {
  if (link.environmentId !== null) return null;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  for (const threadId of decodedId === null ? [link.threadId] : [link.threadId, decodedId]) {
    let match: ScopedThreadRef | null = null;
    for (const ref of refs) {
      if (ref.threadId !== threadId) continue;
      if (match !== null) return null;
      match = ref;
    }
    if (match !== null) return match;
  }
  return null;
}

function threadLinkHref(link: ThreadLink): string {
  return link.environmentId === null
    ? `${V1_PREFIX}${link.threadId}`
    : `${V2_PREFIX}${link.environmentId}/${link.threadId}`;
}

const linkLabel = (label: string | undefined) =>
  label
    ?.replace(/[[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Without a label, an autolink: clients show the thread's current title. */
export function formatThreadLink(ref: ThreadLink, label?: string): string {
  const cleaned = linkLabel(label);
  const href = threadLinkHref(ref);
  const destination = /[()]/.test(href) ? `<${href}>` : href;
  return cleaned ? `[${cleaned}](${destination})` : `<${href}>`;
}

/** What a person copies out of the app: a Markdown link that opens the thread there. */
export function formatAppThreadLink(ref: ScopedThreadRef, label: string, origin: string): string {
  const href = appThreadLink(ref, origin);
  const cleaned = linkLabel(label);
  return cleaned ? `[${cleaned}](${href})` : href;
}

function hasThreadLinks(markdown: string, appPrefix: string | null): boolean {
  return (
    markdown.includes(`${THREAD_LINK_PROTOCOL}://v`) ||
    (appPrefix !== null && markdown.includes(appPrefix))
  );
}

/** Every thread the markdown's links can name, so their titles are keyed reads. */
export function threadLinkRefs(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  appOrigin?: string,
): ReadonlyArray<ScopedThreadRef> {
  const refs = new Map<string, ScopedThreadRef>();
  const pattern = threadLinkOutsideCode(appThreadPrefix(appOrigin));
  for (let match = pattern.exec(markdown); match !== null; match = pattern.exec(markdown)) {
    const href =
      match.groups?.angleHref ?? match.groups?.href ?? match.groups?.autolink ?? match.groups?.bare;
    const link = href === undefined ? null : parseThreadLinkHref(href, appOrigin);
    if (link === null) continue;
    for (const ref of threadLinkCandidates(link, messageEnvironmentId)) {
      refs.set(`${ref.environmentId}/${ref.threadId}`, ref);
    }
  }
  return [...refs.values()];
}

export function unknownThreadLinkLabel(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
): string {
  return link.environmentId === null || link.environmentId === messageEnvironmentId
    ? "Thread no longer available"
    : "Thread on another machine";
}

/** Rewrites each link outside code `replace` answers for. `label` is a Markdown link's own text. */
export function replaceThreadLinks(
  markdown: string,
  replace: (link: ThreadLink, label: string | undefined) => string | undefined,
  appOrigin?: string,
): string {
  const appPrefix = appThreadPrefix(appOrigin);
  if (!hasThreadLinks(markdown, appPrefix)) return markdown;
  return markdown.replace(threadLinkOutsideCode(appPrefix), (source, ...args) => {
    const groups = args.at(-1) as Partial<
      Record<"angleHref" | "href" | "autolink" | "bare" | "label", string>
    >;
    const href = groups.angleHref ?? groups.href ?? groups.autolink ?? groups.bare;
    const link = href === undefined ? null : parseThreadLinkHref(href, appOrigin);
    return (link && replace(link, groups.label)) ?? source;
  });
}

/**
 * Writes each link with its thread's current title, an app link as a v2 link. A link `title`
 * cannot resolve becomes plain text, its written label or a neutral one, except a labeled v1
 * link, which may open elsewhere.
 */
export function relabelThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  title: (ref: ScopedThreadRef) => string | undefined,
  appOrigin?: string,
): string {
  return replaceThreadLinks(
    markdown,
    (written, label) => {
      const environmentId = written.environmentId ?? messageEnvironmentId;
      const decoded = percentDecodedThreadLinkId(written.threadId);
      const threadId =
        title({ environmentId, threadId: written.threadId }) === undefined &&
        decoded !== null &&
        title({ environmentId, threadId: decoded }) !== undefined
          ? decoded
          : written.threadId;
      const current = title({ environmentId, threadId });
      if (current === undefined) {
        if (label !== undefined && written.environmentId === null) return undefined;
        return label?.trim() || unknownThreadLinkLabel(written, messageEnvironmentId);
      }
      return formatThreadLink(
        { environmentId: written.environmentId, threadId },
        current.trim() || label || threadId,
      );
    },
    appOrigin,
  );
}
