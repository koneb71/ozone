// Checks what search engines and link previews read on every page this site links to, and its
// robots.txt and sitemap. Ozone runs it before it calls a build done: `npm run seo`.
const base = process.env.SEO_BASE_URL ?? "http://127.0.0.1:3000";
const MAX_PAGES = 50;
const problems = [];
const problem = (where, what) => problems.push(`${where}: ${what}`);

const decode = (text) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();

const attributes = (tag) => {
  const found = new Map();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    found.set(match[1].toLowerCase(), decode(match[2]));
  }
  return found;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The first request waits for a server that is still starting. */
async function fetchPath(path, attempts = 1) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(new URL(path, base), { redirect: "manual" });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(2000);
    }
  }
}

const pathOf = (href) => {
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/api/") || /\.[a-z0-9]+$/i.test(path)) return null;
  return path;
};

function readPage(path, html) {
  const head = html.split(/<\/head>/i)[0];
  const lang = attributes(html.match(/<html\b[^>]*>/i)?.[0] ?? "").get("lang");
  if (!lang) problem(path, "the <html> element has no lang");

  const title = decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (title === "") problem(path, "no title");
  else if (title.length > 70) problem(path, `the title is ${title.length} characters (at most 70)`);

  let description = "";
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const meta = attributes(tag);
    if (meta.get("name") === "description") description = meta.get("content") ?? "";
  }
  if (description === "") problem(path, "no meta description");
  else if (description.length < 50 || description.length > 200) {
    problem(path, `the description is ${description.length} characters (50 to 200)`);
  }

  const h1s = html.match(/<h1[\s>]/gi)?.length ?? 0;
  if (h1s !== 1) problem(path, `${h1s} h1 headings (exactly one)`);

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (!attributes(tag).has("alt")) problem(path, `an image has no alt text: ${tag.slice(0, 80)}`);
  }

  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)) {
    const linked = pathOf(decode(match[1]));
    if (linked !== null) links.push(linked);
  }
  return { title, description, links };
}

const robots = await fetchPath("/robots.txt", 30);
if (robots.status !== 200) problem("/robots.txt", `returned ${robots.status}`);

const sitemap = await fetchPath("/sitemap.xml");
const listed = new Set();
if (sitemap.status === 200) {
  for (const match of (await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)) {
    listed.add(new URL(decode(match[1])).pathname.replace(/\/+$/, "") || "/");
  }
} else {
  problem("/sitemap.xml", `returned ${sitemap.status}`);
}

const queue = ["/", ...listed];
const seen = new Set();
const titles = new Map();
const descriptions = new Map();
while (queue.length > 0 && seen.size < MAX_PAGES) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const response = await fetchPath(path);
  if (response.status >= 300) {
    problem(path, `returned ${response.status}; a link or the sitemap points here`);
    continue;
  }
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) continue;
  const page = readPage(path, await response.text());
  if (page.title !== "") titles.set(page.title, [...(titles.get(page.title) ?? []), path]);
  if (page.description !== "") {
    descriptions.set(page.description, [...(descriptions.get(page.description) ?? []), path]);
  }
  if (sitemap.status === 200 && !listed.has(path)) {
    problem(path, "is linked from the site but missing from site.pages, so not in the sitemap");
  }
  queue.push(...page.links);
}

for (const [title, paths] of titles) {
  if (paths.length > 1) problem(paths.join(", "), `share the title "${title}"`);
}
for (const [, paths] of descriptions) {
  if (paths.length > 1) problem(paths.join(", "), "share one description");
}

if (problems.length > 0) {
  for (const line of problems) console.error(line);
  process.exit(1);
}
console.log(`SEO check passed on ${seen.size} page${seen.size === 1 ? "" : "s"}.`);
