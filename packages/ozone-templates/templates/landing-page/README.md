# __OZONE_APP_NAME__

Built with [Ozone](https://github.com/koneb71/ozone). TanStack Start, React and Tailwind CSS, running in Docker Compose.

## Run it

Ozone starts and stops the site for you. To run it yourself you need only Docker:

```sh
cp .env.example .env   # once
docker compose up --build
```

The site answers on `http://localhost:3000`, or the port in `.env`. The first start installs dependencies.

## Work on it

Node and the dependencies live in the container. Run project commands through `./dev`:

```sh
./dev npm run typecheck
./dev npm run lint
./dev npm run test
./dev npm install <package>
```

## Ship it

Ozone's **Deploy** runs `compose.prod.yaml`. By hand, `docker build --target prod -t my-site .` builds the production image, which serves the site on port 3000.
