# __OZONE_APP_NAME__

An HTTP JSON API: Hono on Node 26, Postgres through Drizzle ORM, request validation with zod. It runs in Docker Compose. Node runs the TypeScript in `src/` directly in development; production runs the compiled `dist/`.

## Commands

Node and the dependencies live inside the service's container, not on this machine. Run every project command through `./dev`:

| To                                      | Run                           |
| --------------------------------------- | ----------------------------- |
| Check types                             | `./dev npm run typecheck`     |
| Check lint and formatting               | `./dev npm run lint`          |
| Fix lint and formatting                 | `./dev npm run format`        |
| Run the tests                           | `./dev npm run test`          |
| Build for production                    | `./dev npm run build`         |
| Add a dependency                        | `./dev npm install <package>` |
| Write a migration after a schema change | `./dev npm run db:generate`   |
| Apply migrations                        | `./dev npm run db:migrate`    |

The service is already running, and restarts by itself on every saved change.

## Where things go

- `src/app.ts` is the whole service: each resource is a Hono router in `src/routes/`, mounted there under `/api/...`.
- `src/routes/health.ts` answers `/api/health`, which Docker uses to tell whether the service is up. Keep it.
- `src/db/schema.ts` holds the tables. `drizzle/` holds generated SQL migrations: never edit or delete one that already exists. A migration that can lose data, such as one that drops a table or a column, waits for the person: `db:migrate` holds it back until they accept it in Ozone. Tell them what it does. Never change `src/db/migrate.ts` or `src/db/migration-guard.ts` to get one through.
- `src/index.ts` starts the server. `compose.prod.yaml` is how Ozone deploys the service: keep it working when you add a service.

## How to write it

- Relative imports name the file with its `.ts` extension, such as `import { db } from "../db/index.ts"`: Node runs the source as it is. No path aliases, enums or namespaces.
- A router per resource:

  ```ts
  import { zValidator } from "@hono/zod-validator";
  import { Hono } from "hono";
  import { z } from "zod";
  import { db } from "../db/index.ts";
  import { items } from "../db/schema.ts";

  export const itemRoutes = new Hono()
    .get("/", async (c) => c.json(await db.select().from(items)))
    .post("/", zValidator("json", z.object({ name: z.string().min(1) })), async (c) => {
      const [item] = await db.insert(items).values(c.req.valid("json")).returning();
      return c.json(item, 201);
    });
  ```

  Then mount it in `src/app.ts`: `.route("/api/items", itemRoutes)`.
- Validate every body, query and parameter with zod. Answer errors as JSON with the right status: 400 for bad input, 404 for a missing record, 409 for a conflict.
- Read settings and secrets from `process.env`, never from a file in the repository.
- Test each route with `app.request(...)` in a `*.test.ts` file next to it. Tests run in the container, where the database is reachable.

## Done means

`./dev npm run typecheck`, `./dev npm run lint` and `./dev npm run test` pass, and the endpoint answers in the running service.

## Ozone

<!-- ozone:instructions -->
