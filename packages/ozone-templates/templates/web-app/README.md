# __OZONE_APP_NAME__

Built with [Ozone](https://github.com/koneb71/ozone). TanStack Start, React, Tailwind CSS, Postgres through Drizzle, and Better Auth, running in Docker Compose.

## Run it

Ozone starts and stops the app for you. To run it yourself you need only Docker:

```sh
cp .env.example .env   # once; set BETTER_AUTH_SECRET
docker compose up --build
```

The app answers on `http://localhost:3000`, or the port in `.env`. The first start installs dependencies and applies the database migrations.

## Work on it

Node and the dependencies live in the container. Run project commands through `./dev`:

```sh
./dev npm run typecheck
./dev npm run lint
./dev npm run test
./dev npm install <package>
./dev npm run db:generate   # after changing src/db/schema.ts
```

## Your data

The database lives in the Docker volume `pgdata`. Stopping, restarting and rebuilding the app keep it. `docker compose down -v` and `docker volume rm` delete it: do not run them unless you mean to lose the data.

## Ship it

`docker build --target prod -t my-app .` builds a production image. It needs `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` at run time, and the migrations in `drizzle/` applied to the database.
