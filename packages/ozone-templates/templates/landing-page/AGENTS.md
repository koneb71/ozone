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
- `src/lib/site.ts` holds the site's name and tagline.
- `src/components/ui/` holds the base components (button, card, input, label). Add new ones in the same style. The site's own components go in `src/components/`.
- `src/styles/app.css` holds the design tokens. `public/` holds images and the favicon.
- `compose.prod.yaml` is how Ozone deploys the site. Keep it working when you add a service.

## How to write it

- The installed TanStack packages ship guides that match their version. Read the one for what you are about to write, for example `./dev find node_modules/@tanstack -name SKILL.md`.
- Each section says one thing. Headings say what the visitor gets, not what the product is called.
- Give every page a title and a description in its route's `head`, for search and for links shared elsewhere.
- Style with Tailwind utilities and the tokens: `bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`. No colour literals in components. Light and dark must both look right.
- Every page works at 360 px wide and on a desktop. Images have alt text; controls are reachable by keyboard and have accessible names.
- A form that must send something needs a service to send it to. Ask the user which one before you build it.
- Cover logic that can break with vitest tests next to the code (`*.test.ts`).

## Done means

`./dev npm run typecheck`, `./dev npm run lint` and `./dev npm run test` pass, and the page looks right in the running site.

## Ozone

<!-- ozone:instructions -->
