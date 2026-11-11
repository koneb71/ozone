FROM node:26-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Development: the project is bind-mounted over /app and dependencies live in
# a named volume, so this stage copies nothing and needs no network access.
FROM base AS dev
ENV HOME=/tmp/home
# The container runs as the host user, whatever its uid, so every path it
# writes to outside the bind mount has to be world-writable.
RUN mkdir -p /app/node_modules "$HOME" && chmod 0777 /app/node_modules "$HOME"
EXPOSE 3000
CMD ["sh", "docker/dev-entrypoint.sh"]

FROM base AS build
COPY package.json package-lock.json ./
# `--secret id=host_ca,src=<bundle>` lets npm trust a TLS-intercepting proxy.
RUN --mount=type=secret,id=host_ca,required=false sh -c 'if [ -f /run/secrets/host_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/host_ca; fi; npm ci'
COPY . .
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
