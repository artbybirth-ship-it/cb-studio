#!/usr/bin/env sh
# Stops the Docker stack, removes the old containers, then starts it fresh.
# Named volumes (postgres_data, media_data) are kept, so DB and media survive.
set -e
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin"
cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { printf 'docker not found in PATH.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker is not running.\n' >&2; exit 1; }

printf '1/3 Stopping containers...\n'
docker compose stop
printf '2/3 Removing old containers...\n'
docker compose down --remove-orphans
printf '3/3 Starting containers...\n'
docker compose up --build -d
docker compose ps
