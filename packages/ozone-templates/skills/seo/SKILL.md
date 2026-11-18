---
name: seo
description: Search and sharing basics for every public page of this app. Use before adding a page, changing a page's title, headings, links or images, or setting the live address.
---

# SEO for this app

Search engines and link previews read a page's head, headings, links and images. Get these right
on every page people can reach without signing in. Pages behind sign-in still get a title, and stay
out of the sitemap.

## Every page's head

- Build the head with `seo()` from `src/lib/seo.ts` in the route's `head`. It sets the title, the
  description, the Open Graph and Twitter tags, and the canonical link once `site.url` is set.
- Title: what the page is, then the site, as `Pricing · Acme`. Keep it under about 60 characters.
  The home page may use the site name and what it offers.
- Description: 120 to 160 characters that say what the visitor gets on this page, in plain words.
  Every page has its own; never repeat one.
- Set `site.url` in `src/lib/site.ts` once the live address is known (after the first deploy). Until
  then, leave it empty: canonical links and the sitemap use the address the page was served from.

## The page itself

- Exactly one `h1`, naming what the page is about. Headings below it go in order, without skipping
  a level.
- Link text says where the link goes. Never "click here" or "learn more" alone.
- Every `img` has `alt` text that says what it shows; a purely decorative image has `alt=""`.
- Give images a `width` and `height`, lazy-load images below the first screen, and never lazy-load
  the main image at the top.
- Paths are lowercase words joined with hyphens: `/pricing`, `/about-us`.
- Text is real text, not text inside images.

## Pages and the sitemap

- Add every public page's path to `site.pages` in `src/lib/site.ts`. The sitemap is built from it,
  and the final check fails when a page it can reach is missing.
- `robots.txt` allows everything public and points at the sitemap. Keep `/api/` out.

## Sharing

- A social image is `public/og.png`, 1200 × 630, made from real material for this site: its name,
  its product, its photos. Never a stock placeholder. Without one, leave the image tags out.

## Structured data

- Add JSON-LD only for facts that are true and shown on the page: the organization, a product, an
  article, opening hours. Never invent ratings, reviews, prices or awards.

## Speed and access

- Fast pages rank better. For images, fonts, layout shift and accessible forms and dialogs, search
  `ozone_web_guidance` before writing the code.
