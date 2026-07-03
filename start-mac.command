#!/bin/bash
# Arrancador para macOS: instala dependencias si faltan, inicia el servidor y abre la webapp.
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Instalando dependencias..."
  npm install
fi

PORT="${PORT:-3117}"

# Si ya hay un servidor en el puerto, solo abre el navegador
if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Market Analyzer ya está corriendo en el puerto $PORT."
  open "http://localhost:$PORT"
  exit 0
fi

echo "Iniciando Market Analyzer en http://localhost:$PORT ..."
node server.js &
SERVER_PID=$!

# Espera a que el servidor responda antes de abrir el navegador
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT"; then
    break
  fi
  sleep 0.5
done

open "http://localhost:$PORT"

echo "Servidor corriendo (PID $SERVER_PID). Cierra esta ventana para detenerlo."
wait $SERVER_PID
