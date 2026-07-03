@echo off
REM Arrancador para Windows: instala dependencias si faltan, inicia el servidor y abre la webapp.
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)

if "%PORT%"=="" set PORT=3117

echo Iniciando Market Analyzer en http://localhost:%PORT% ...
start "Market Analyzer" cmd /c "node server.js"

REM Espera a que el servidor responda antes de abrir el navegador
set count=0
:waitloop
curl -s -o nul "http://localhost:%PORT%"
if %errorlevel%==0 goto ready
set /a count+=1
if %count% geq 30 goto ready
timeout /t 1 /nobreak >nul
goto waitloop

:ready
start "" "http://localhost:%PORT%"
echo Servidor corriendo en una ventana aparte. Cierra esa ventana para detenerlo.
pause
