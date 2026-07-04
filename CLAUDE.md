# CLAUDE.md — Market Analyzer

## Rol del Agente
Co-desarrollador. Implementa features, corrige bugs, refactoriza. No toma decisiones de arquitectura de datos (nuevas fuentes, cambios de scoring) sin confirmación.

## Stack Técnico
- **Runtime**: Node.js (ESM, `"type": "module"`)
- **Backend**: Express 4 (`server.js`) — dual-mode: `app.listen()` local, `export default app` para Vercel serverless
- **Frontend**: Vanilla JS (`public/app.js`) + lightweight-charts vía CDN — sin build step
- **Deploy**: Vercel (proyecto `market-analyzer`, cuenta `oreyes100`) — `api/index.js` reexporta la app, `vercel.json` hace rewrite de todo a esa función (`maxDuration: 60`)
- **Repo**: [github.com/oreyes100/market-analyzer](https://github.com/oreyes100/market-analyzer)

## Contexto del Proyecto
Analiza mercado de criptomonedas (BTC/ETH/SOL/BNB/XRP/ADA), acciones (AAPL/MSFT/NVDA/GOOGL/AMZN/META/TSLA) y ETFs (SPY/QQQ/VTI/GLD/IBIT/TLT). Combina técnico (RSI/MACD/SMA/Bollinger), chartismo (soportes/resistencias por clustering de pivotes, patrones), fundamental (mcap/ATH/rango 52 semanas) y sentimiento de 5 analistas de YouTube (keywords ES/EN ponderadas por recencia). Landing de oportunidades con entrada/objetivo/stop + registro de cartera con P&L en vivo.

## Arquitectura Clave
```
server.js              ← Express app + rutas API + scoring + rutas Core IA (/api/intel, /api/alerts, /api/voice/*)
lib/sources.js          ← fuentes de datos externas, colas de rate-limit, caché con fallback a dato caducado
lib/indicators.js       ← RSI, MACD, SMA/EMA, Bollinger, pivotes, soportes/resistencias, patrones
lib/sentiment.js        ← sentimiento por keywords sobre títulos (ES/EN)
lib/aliases.js          ← alias de los 19 activos para detección en texto libre + mapeo StockTwits
lib/transcripts.js      ← Agente A: transcripciones YouTube vía yt-dlp (solo local), niveles alegados
lib/social.js           ← Agente B: StockTwits + Reddit RSS, picos de volumen vs baseline
lib/intel.js            ← orquestador: fusión de scores + generación de alertas + sentiment_deep.json
lib/ollama.js           ← LLM local opcional (think:false obligatorio para qwen3.x)
api/index.js            ← entrypoint Vercel (reexporta server.js)
public/                 ← frontend estático; voice.js = Agente C (Web Speech STT/TTS + intents)
data/                   ← investments.json, sentiment_deep.json, alerts.json, transcripts/ (gitignored salvo estructura)
```

## Fuentes de Datos Externas (todas gratis, sin API key)
| Dato | Primaria | Fallback | Nota |
|---|---|---|---|
| OHLC crypto | Coinbase Exchange | CoinGecko OHLC | Binance NO usar — HTTP 451 en IPs US/Vercel |
| Metadata crypto (mcap, ATH...) | CoinGecko | — | Rate limit estricto, cola de 2s |
| OHLC acciones/ETFs | NASDAQ API | Yahoo Finance | Yahoo 429 persistente desde IPs de nube |
| Fear & Greed | alternative.me | — | |
| Vídeos analistas | RSS YouTube (`/feeds/videos.xml?channel_id=`) | — | Resolver `channelId` real por @handle antes de asumir que existe |
| Transcripciones YouTube | yt-dlp (binario local) | — | Endpoints web bloqueados (POT/400); SOLO local, no Vercel |
| Sentimiento social | StockTwits (`BTC.X`, `AAPL`...) | — | Sin key; sustituto de X/Twitter (sin vía gratis/legal) |
| Reddit | RSS (`/hot.rss`) | — | El endpoint `.json` devuelve muro HTML — NO usar |
| LLM (opcional) | Ollama local :11434 | modo determinista | qwen3.x exige `think:false` o respuesta vacía |

## Restricciones Permanentes
- No commitear ni hacer `vercel deploy --prod` sin confirmación explícita.
- No crear archivos `.md` que no fueron pedidos.
- No agregar features más allá de lo pedido.
- No agregar manejo de errores para escenarios que no pueden ocurrir — solo validar en boundaries reales (APIs externas).
- No asumir que una fuente de datos gratis funciona igual en local que en Vercel — el rate-limit/geo-block depende de la IP (ver Decision Journal).
- Antes de acción destructiva (reset, force-push, borrar rama): confirmar con el usuario.
- Si tarea afecta **>3 archivos** → exponer plan antes de editar (driver Plan First).
- Nueva fuente de datos externa (endpoint, API) → documentar spec + quirks reales (rate limits, formato de respuesta, geo-restricciones) en Decision Journal ANTES de integrarla al scoring (driver SDD, scoped a ese módulo).

## Vault de Conocimiento (Fuente de Metodología)
Este proyecto está anidado dentro del vault Obsidian (`../` desde esta carpeta). Cargar JIT — nunca releer `Wiki/` completo, solo lo listado abajo:
- Governance base: `../Meta/CLAUDE.md`, `../Meta/core-invariants.md`
- Índice de drivers disponibles: `../Meta/METHODOLOGIES_INDEX.md`
- **Drivers activos para este proyecto** (tipo Software/Backend): Plan First + Session Efficiency + SDD (scoped a integraciones de nuevas fuentes externas)
- Persistent Context ya está activo de facto (`.claude/memory/`) — no requiere nueva configuración.
- Referencia de tabla de decisión: `../Meta/CORE/METHODOLOGY_PROJECT_BOOTSTRAP.md` fila "Software / Backend"

## Protocolo `/close` (cierre de sesión)
Cuando el usuario escriba `/close` (o "cierra sesión"), ejecutar el cierre de Persistent Context:
1. Actualizar `.claude/memory/Contexto Activo.md`: mover "Última Sesión" a "Sesión Anterior", registrar completado/pendiente/próximos pasos, actualizar fecha del pie.
2. Si hubo decisiones arquitectónicas nuevas (nueva fuente de datos, cambio de scoring, cambio de deploy) → agregar entrada en `.claude/memory/Decision Journal.md` (formato: Contexto / Decisión / Por qué / Alternativa descartada / Estado).
3. Si hubo un error/quirk descubierto que otra sesión repetiría → agregar a `.claude/memory/learned-rules.md`.
4. Append en `.claude/memory/sessions.jsonl`: `{"date":"YYYY-MM-DD","session_n":N,"summary":"...","score":1-10}`.
5. NO commitear como parte del cierre (regla de confirmación explícita aplica igual).
6. Responder solo con un resumen de 3-5 líneas de lo registrado.

## Formato de Output
- Respuestas concisas. Sin intro genérica.
- Sin summary al final.
- Código: siempre con path del archivo. Sin comentarios obvios.
- Errores: citar exacto el mensaje, no parafrasear.

## Comandos de Referencia
- `npm install && npm start` — servidor local en puerto 3117 (o `./start-mac.command` / `start-windows.bat`)
- `vercel deploy --prod` — deploy a producción (requiere confirmación)
- `vercel logs https://market-analyzer-delta.vercel.app --json` — diagnosticar fallos en producción (console.warn no se ve sin esto)
- `curl -s http://localhost:3117/api/overview` — probar el endpoint más pesado (analiza los 19 activos)
