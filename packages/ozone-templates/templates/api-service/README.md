# __OZONE_APP_NAME__

Built with [Ozone](https://github.com/koneb71/ozone). An HTTP JSON API: Hono on Node, Postgres through Drizzle and zod, running in Docker Compose.

## Run it

Ozone starts and stops the service for you. To run it yourself you need only Docker:

```sh
cp .env.example .env   # once
docker compose up --build
```

The service answers on `http://localhost:3000`, or the port in `.env`. The first start installs dependencies and applies the database migrations.

## Work on it

Node and the dependencies live in the container. Run project commands through `./dev`:

```sh
./dev npm run typecheck
./dev npm run lint
./dev npm run test
./dev npm install <package>
./dev npm run db:generate   # after changing src/db/schema.ts
```

On Windows the same commands work from PowerShell and `cmd`, through `dev.cmd`.

## Your data

The database lives in the Docker volume `pgdata`. Stopping, restarting and rebuilding the service keep it. `docker compose down -v` and `docker volume rm` delete it: do not run them unless you mean to lose the data.

## Ship it

Ozone's **Deploy** runs `compose.prod.yaml`. By hand, `docker build --target prod -t my-api .` builds the production image. It needs `DATABASE_URL` at run time, and the migrations in `drizzle/` applied to the database.
