#!/usr/bin/env sh
set -e
printf 'Starting CharacterBazaarStudio on LAN IP 192.168.1.42...\n'
docker compose down
docker compose up --build -d
printf '\nReady URLs:\n'
printf 'Studio:  http://192.168.1.42:3000\n'
printf 'API:     http://192.168.1.42:8000/api/\n'
printf 'AI docs: http://192.168.1.42:8100/docs\n'
docker ps
