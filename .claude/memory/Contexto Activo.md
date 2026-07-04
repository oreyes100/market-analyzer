# Contexto Activo — Market Analyzer / Sesión actual

## Estado del Proyecto
- **Versión**: 2.0 (Core IA integrado; sin commitear aún)
- **Sprint activo**: NINGUNO
- **Deploy**: Vercel (producción, aún en v1.0) — https://market-analyzer-delta.vercel.app, rama `main`

## Última Sesión (2026-07-03, sesión 3)
### Completado
- **Core IA completo** (spec del usuario: 3 sub-agentes + voz), verificado end-to-end en local:
  - **Agente A** (`lib/transcripts.js`): transcripciones completas de YouTube vía yt-dlp (endpoints web bloqueados — ver Decision Journal), ventanas de 30s, filtro de intros/patrocinios, detección de menciones por activo (`lib/aliases.js`), sentimiento, y niveles alegados (objetivos/soportes/resistencias por regex con normalización es/en). 9/10 vídeos con transcripción en la primera corrida; idioma original priorizado.
  - **Agente B** (`lib/social.js`): StockTwits (Bullish/Bearish nativo + picos de mensajes/hora vs baseline EMA) + Reddit vía RSS. X/Twitter sustituido con aprobación del usuario (sin vía gratuita/legal).
  - **Fusión** (`lib/intel.js`): fusedScore = base + pesos por tipo (crypto pondera social/YouTube al doble que acciones), alertas (cambio de acción, pico social, señal contraria con F&G≤25, RSI extremo, stop/target de cartera), persistido en `data/sentiment_deep.json` + `data/alerts.json`. Ciclo cada 15 min solo local.
  - **Agente C** (`public/voice.js`): Web Speech API (STT es-MX + TTS), intents deterministas (cartera, informe, análisis de activo, añadir/eliminar posición con confirmación verbal, alertas on/off), alertas proactivas habladas (poll 60s), fallback a pregunta libre vía Ollama. Disclaimer obligatorio en cada informe (server-side).
  - **Ollama opcional** (`lib/ollama.js`): detectado qwen3.5:9b-mlx; quirk `think:false` resuelto; degradación limpia si no corre.
  - **Rutas nuevas**: `/api/intel`, `/api/alerts`, `/api/aliases`, `/api/voice/brief`, `/api/voice/ask`. Refactor: `buildOverview()` y `enrichInvestments()` extraídas y reutilizadas.
  - **UI**: pestaña 🧠 IA (recomendaciones fusionadas con drivers y fuentes expandibles, cobertura de transcripciones) + widget de voz flotante.
- Bootstrap de metodología (CLAUDE.md + .claude/memory) hecho al inicio de esta sesión.
- **Detectado**: el proyecto ahora vive en `<vault>/market-analyzer` (se movió desde `Proyectos/market-analyzer`); launch.json de ambos vaults actualizado.

### Pendiente
- **Commit + push + deploy de v2.0 sin hacer** — requiere confirmación explícita del usuario (regla CLAUDE.md). En Vercel el Agente A quedará desactivado (sin yt-dlp) — ya degradado y documentado.
- Probar STT con micrófono real (en preview headless el permiso se deniega; TTS/intents/panel verificados).

## Sesión Anterior (2026-07-03, sesión 2)
### Completado
- **Fix canales YouTube**: Satoshi Stacker → `@satoshistackerES` (el handle viejo `@stackersatoshi` devolvía títulos auto-doblados al árabe), James Rickards → `@itmtrading` (el canal "JamesRickardsProject" ya no resolvía). Verificado en vivo: títulos legibles en ambos.
- **Publicado en GitHub**: repo propio `oreyes100/market-analyzer` (nuevo, no reutiliza el git del `$HOME` del usuario).
- **Desplegado en Vercel**: proyecto nuevo, auto-deploy conectado al repo. Requirió adaptar la app (ver Decision Journal): exportar la app Express en vez de forzar `listen()`, desactivar el calentador de caché en background fuera de local, cartera en `/tmp` en Vercel.
- **Fix fuente de datos crypto**: Binance devolvía HTTP 451 (bloqueo geográfico) desde IPs de Vercel/US → cambiado a Coinbase Exchange (sin key, sin bloqueo). Verificado: 19/19 activos cargan sin error en producción.
- **Arrancadores creados**: `start-mac.command` y `start-windows.bat` — instalan deps, arrancan servidor, esperan respuesta, abren navegador.
- **Bootstrap de este mismo archivo**: `CLAUDE.md` + `.claude/memory/*` + `.claude/commands/{boot,close}.md`, siguiendo el patrón ya validado en `meeting-scheduler-pro` (proyecto hermano en este vault) y el driver recomendado por `Meta/CORE/METHODOLOGY_PROJECT_BOOTSTRAP.md` para proyectos Software/Backend (Plan First + Session Efficiency + SDD).

### Pendiente
- (nada bloqueante)

## Historial (2026-07-02, sesión 1)
### Completado
- Construcción completa de la webapp: `server.js`, `lib/{sources,indicators,sentiment}.js`, `public/{index.html,app.js,style.css}`.
- Fuentes integradas: CoinGecko (metadata crypto), Yahoo Finance (fallback stocks — luego reemplazado por NASDAQ), alternative.me (Fear & Greed), RSS de YouTube (5 analistas).
- Landing de oportunidades con score combinado (técnico + fundamental + chartismo + sentimiento + Fear&Greed) y entrada/objetivo/stop.
- Registro de cartera (CRUD) con P&L en vivo, persistido en `data/investments.json`.
- Verificado end-to-end en navegador (preview tools): las 4 pestañas, gráficos con lightweight-charts, alta/baja de inversión.
- Fix inicial de rate-limits: colas por fuente, reintentos con backoff, caché con TTL que sirve dato caducado si la fuente falla, calentador de caché en background (solo local).

## Bugs Conocidos
(ninguno abierto)

## Estado Técnico Actual
- Fuente OHLC crypto: **Coinbase Exchange** (primaria) → CoinGecko OHLC (fallback). Binance excluido (451 en US).
- Fuente OHLC acciones/ETFs: **NASDAQ API** (primaria) → Yahoo Finance (fallback, 429 frecuente).
- Timeout por activo en `/api/overview`: 45s (subido de 12s original — necesario para que la cola serial de rate-limit tenga margen en frío, especialmente en Vercel).
- Cartera: persistente en local (`data/investments.json`), **efímera en Vercel** (`/tmp`, se borra en cada cold start/redeploy).
- Calentador de caché en background (`setInterval` cada 15 min): solo corre si `!process.env.VERCEL` — no tiene sentido en funciones serverless.

## Próximos Pasos — Prioridad
1. 🔴 Pedir confirmación para commit + push + deploy de v2.0 (Core IA).
2. 🟡 Probar voz con micrófono real en Chrome (permiso denegado en preview headless).
3. 🟢 Si se agrega una fuente de datos externa nueva, documentar spec + quirks reales en Decision Journal antes de integrarla (driver SDD scoped).

## Notas Arquitectónicas
- `server.js` es dual-mode: `export default app` siempre; `app.listen()` solo si `!process.env.VERCEL`.
- `api/index.js` es un simple `export { default } from '../server.js'` — todo el ruteo real vive en `server.js`.
- `vercel.json` hace rewrite de **todo** a `/api/index` (incluyendo estáticos) — Express sirve `public/` internamente vía `express.static`.

---
*Actualizado: 2026-07-03 (sesión 3)*
