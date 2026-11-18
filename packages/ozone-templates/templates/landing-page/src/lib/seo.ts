import { site } from "@/lib/site";

/**
 * A page's head: its title and description, and the tags search engines and link previews read.
 * Leave out the title on the home page to use the site's name alone.
 */
export function seo(page: { title?: string; description?: string; path: string }) {
  const title = page.title === undefined ? site.name : `${page.title} · ${site.name}`;
  const description = page.description ?? site.description;
  const url = site.url === "" ? undefined : new URL(page.path, site.url).href;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: site.name },
      { name: "twitter:card", content: "summary" },
      ...(url === undefined ? [] : [{ property: "og:url", content: url }]),
    ],
    links: url === undefined ? [] : [{ rel: "canonical", href: url }],
  };
}
