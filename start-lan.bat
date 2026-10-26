@echo off
echo Starting CharacterBazaarStudio on LAN IP 192.168.1.42...
docker compose down
if errorlevel 1 goto :error
docker compose up --build -d
if errorlevel 1 goto :error
echo.
echo Ready URLs:
echo Studio:  http://192.168.1.42:3000
echo API:     http://192.168.1.42:8000/api/
echo AI docs: http://192.168.1.42:8100/docs
docker ps
pause
exit /b 0
:error
echo Docker command failed. Check that Docker Desktop is running.
pause
exit /b 1
