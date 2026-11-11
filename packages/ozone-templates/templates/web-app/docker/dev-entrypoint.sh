#!/bin/sh
# Starts the app for development: installs dependencies when they are missing
# or out of date, applies database migrations, then runs the dev server.
# Safe to run again at any time.
set -eu

cd /app

log() {
  printf '==> %s\n' "$*"
}

# node_modules is a Docker volume, so the stamp records which package.json and
# package-lock.json it was installed from.
stamp=node_modules/.install-stamp
manifest_hash() {
  cat package.json package-lock.json 2>/dev/null | sha256sum | cut -d ' ' -f 1
}

if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$(manifest_hash)" ]; then
  if [ -f package-lock.json ] && [ ! -e node_modules/.package-lock.json ]; then
    log "Installing dependencies from package-lock.json (npm ci)"
    npm ci
  else
    log "package.json or package-lock.json changed; updating dependencies (npm install)"
    npm install
  fi
  manifest_hash > "$stamp"
else
  log "Dependencies are up to date"
fi

log "Applying database migrations"
npm run --silent db:migrate

log "Starting the dev server on http://0.0.0.0:3000"
exec npm run --silent dev
