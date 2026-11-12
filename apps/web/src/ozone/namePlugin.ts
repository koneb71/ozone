import type { Plugin } from "vite-plus";

/**
 * Upstream's screens say "T3 Code" in more than a hundred places and its tests quote them, so the
 * text is rewritten when the client is built or served, never in the source. Tests run without
 * this plugin and keep reading upstream's words.
 */
const REPLACEMENTS = [
  // "T3 Code for GitHub" is upstream's GitHub App, which keeps its name.
  [/T3 Code(?! for GitHub)/g, "Ozone"],
  [/pingdotgg\/t3code/g, "koneb71/ozone"],
  [/https:\/\/t3\.codes\/download/g, "https://github.com/koneb71/ozone/releases/latest"],
] as const;

/** The client's own source and the workspace packages bundled into it. */
const SOURCES = /\/(?:apps\/web|packages\/[^/]+)\/src\/.*\.(?:ts|tsx)$/;

const rename = (text: string) =>
  REPLACEMENTS.reduce((renamed, [from, to]) => renamed.replaceAll(from, to), text);

export function ozoneNamePlugin(): Plugin {
  return {
    name: "ozone:name",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!SOURCES.test(file)) return null;
      const renamed = rename(code);
      // Lines keep their numbers, which is what a stack trace needs.
      return renamed === code ? null : { code: renamed, map: null };
    },
    // After upstream's own plugin has written the page title.
    transformIndexHtml: { order: "post", handler: (html) => rename(html) },
  };
}
