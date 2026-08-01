@echo off
echo ============================================
echo  Supermercado Avicola - Iniciando servicios
echo ============================================
if not exist "%~dp0.env" (
  echo Creando archivo .env desde .env.example...
  copy "%~dp0.env.example" "%~dp0.env" >nul
)
cd /d "%~dp0infra"
docker compose up --build -d
echo.
echo Esperando a que los servicios esten listos...
timeout /t 5 /nobreak >nul
echo.
echo ============================================
echo  Backend:  http://localhost:8000
echo  API Docs: http://localhost:8000/docs
echo  DB:       localhost:5432
echo ============================================
echo.
echo Para detener: docker compose -f infra/docker-compose.yml down
pause
