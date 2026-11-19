# __OZONE_APP_NAME__

A website: TanStack Start (React 19, file-based routes, rendered on the server), Tailwind CSS 4 with shadcn-style components. It has no database and no accounts. It runs in Docker Compose.

## Commands

Node and the dependencies live inside the site's container, not on this machine. Run every project command through `./dev`:

| To                        | Run                           |
| ------------------------- | ----------------------------- |
| Check types               | `./dev npm run typecheck`     |
| Check lint and formatting | `./dev npm run lint`          |
| Fix lint and formatting   | `./dev npm run format`        |
| Run the tests             | `./dev npm run test`          |
| Build for production      | `./dev npm run build`         |
| Add a dependency          | `./dev npm install <package>` |

The dev server is already running with hot reload. Saved edits appear without a restart.

## Where things go

- `src/routes/` holds pages. A file is a route: `src/routes/pricing.tsx` is `/pricing`. `src/routeTree.gen.ts` is generated: never edit it.
- `src/routes/index.tsx` is a placeholder with placeholder sections. The site's own home page replaces it.
- `src/lib/site.ts` holds the site's name, tagline, description, its public pages and, once it is deployed, its address. `src/lib/seo.ts` builds a page's head from them.
- `src/routes/robots[.]txt.ts` and `src/routes/sitemap[.]xml.ts` serve `/robots.txt` and `/sitemap.xml`.
- `src/components/ui/` holds the base components (button, card, input, label). Add new ones in the same style. The site's own components go in `src/components/`.
- `src/styles/app.css` holds the design tokens. `public/` holds images and the favicon.
- `compose.prod.yaml` is how Ozone deploys the site. Keep it working when you add a service.

## How to write it

- The installed TanStack packages ship guides that match their version. Read the one for what you are about to write, for example `./dev find node_modules/@tanstack -name SKILL.md`.
- Each section says one thing. Headings say what the visitor gets, not what the product is called.
- Give every page its own title and description through `seo()` in its route's `head`, and add its path to `site.pages`: the sitemap lists those, and the final check reads every page it can reach.
- Style with Tailwind utilities and the tokens: `bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`. No colour literals in components. Light and dark must both look right.
- Every page works at 360 px wide and on a desktop. Images have alt text; controls are reachable by keyboard and have accessible names.
- A form that must send something needs a service to send it to. Ask the user which one before you build it.
- Cover logic that can break with vitest tests next to the code (`*.test.ts`).

## Design

When these disagree, what the person asked for comes first, then `DESIGN.md` when it exists (the look they chose), then this section, then the skills it names.

- Before building or restyling a page, read `.agents/skills/design-taste-frontend/SKILL.md` and, from its `references/`, only what the part you build needs (`copy.md` for any words on a page). Its house rules and its Never list apply, except for the motion `DESIGN.md` names. This site is React routes and Tailwind, not the skill's HTML kit: never copy its `assets/` or `starter.html`, never run its `gate.mjs` or `deal.mjs`, and skip any step whose file is not there.
- `.agents/skills/high-end-visual-design/SKILL.md`, `.agents/skills/gpt-taste/SKILL.md`, `.agents/skills/minimalist-ui/SKILL.md` and `.agents/skills/industrial-brutalist-ui/SKILL.md` are for Ozone's Pick the design. Use one only when `DESIGN.md` names it, even if your tools list them. Then `DESIGN.md` wins over its motion, fonts, colours, image services, icon sets, animation libraries and planning steps.
- With `DESIGN.md`, take the colours and the faces from it and skip `start.mjs deal`. Without it, pick them with `./dev node .agents/skills/design-taste-frontend/scripts/start.mjs deal --page <kind> --trade <trade>`, then `css` with the palette and pairing it deals (its output names the command). Put the colours into the tokens in `src/styles/app.css`, with a light and a dark value for each. Load the faces from `@fontsource` packages, never from Google Fonts.
- `.agents/skills/frontend-design/SKILL.md` settles what the rest leaves open: the direction, the type pairing and one signature element.
- `.agents/skills/design-taste-frontend/scripts/consistency.mjs` checks a page in headless Chrome at several widths. It needs Node 22 or later and Chrome on this machine, not in the container. When they are there, run it against the running site with `--out .taste-skill` and treat what it reports as advice. When they are not, skip it and say so. What it reports about the motion `DESIGN.md` names is expected: keep that motion.
- Read `.agents/skills/seo/SKILL.md` before adding a page or changing a title, headings, links or images. Build each page's head with `seo()` from `src/lib/seo.ts`.

## Done means

`./dev npm run typecheck`, `./dev npm run lint` and `./dev npm run test` pass, and the page looks right in the running site. `./dev npm run seo` checks the head, headings and images of every page and the sitemap; Ozone runs it before it calls the build done.

## Ozone

<!-- ozone:instructions -->
