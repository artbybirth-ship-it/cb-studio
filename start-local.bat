@echo off
echo Starting CharacterBazaarStudio v7 locally...
docker compose down
docker compose up --build -d
echo.
echo Studio:  http://localhost:3000
echo API:     http://localhost:8000/api/
echo AI docs: http://localhost:8100/docs
docker compose ps
