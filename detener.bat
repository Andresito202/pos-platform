@echo off
echo Deteniendo servicios...
cd /d "%~dp0infra"
docker compose down
echo Servicios detenidos.
pause
