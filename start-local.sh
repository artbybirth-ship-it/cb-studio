#!/usr/bin/env sh
set -e
printf 'Starting CharacterBazaarStudio v7 locally...\n'
docker compose down
docker compose up --build -d
printf '\nStudio:  http://localhost:3000\n'
printf 'API:     http://localhost:8000/api/\n'
printf 'AI docs: http://localhost:8100/docs\n\n'
docker compose ps
