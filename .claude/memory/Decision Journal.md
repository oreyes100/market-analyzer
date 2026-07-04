# Decision Journal — Market Analyzer

Registro de decisiones arquitectónicas cerradas. No proponer alternativas a estas sin solicitud explícita del usuario.

---

## [2026-07-03] OHLC crypto: Coinbase Exchange en vez de Binance

**Contexto**: Binance (`api.binance.com/api/v3/klines`) funcionaba en pruebas locales pero devolvía **HTTP 451** (bloqueo por motivos legales/geográficos) para las 6 criptos desde IPs de Vercel/US en producción. El fallback a CoinGecko entonces se sobrecargaba (rate limit) intentando cubrir los 6 activos de golpe.

**Decisión**: Fuente primaria de OHLC crypto = Coinbase Exchange (`api.exchange.coinbase.com/products/{PAR}-USD/candles`), sin key, sin bloqueo geográfico en US. CoinGecko queda solo como fallback si Coinbase falla.

**Por qué**: Binance bloquea explícitamente tráfico de EE.UU. (por eso existe Binance.US como entidad separada) — cualquier cloud IP de un proveedor US-based (Vercel, AWS, etc.) puede recibir 451 aunque funcione desde una IP residencial o de otro país.

**Alternativa descartada**: Aumentar reintentos/backoff sobre Binance — descartada porque 451 no es un rate-limit transitorio, es un bloqueo permanente por origen.

**Estado**: CERRADO. Verificado: 19/19 activos cargan sin error en `https://market-analyzer-delta.vercel.app/api/overview`.

---

## [2026-07-03] OHLC acciones/ETFs: NASDAQ API en vez de Yahoo Finance

**Contexto**: Yahoo Finance (`query1/query2.finance.yahoo.com/v8/finance/chart`) devolvía HTTP 429 persistente incluso con cookie de sesión, distintos user-agents y reintentos con backoff — tanto en local como en Vercel.

**Decisión**: Fuente primaria de OHLC para acciones/ETFs = API pública de NASDAQ (`api.nasdaq.com/api/quote/{SYMBOL}/historical`), sin key. Yahoo queda como fallback (`stockChart()` intenta NASDAQ primero, Yahoo si falla).

**Por qué**: NASDAQ respondió consistentemente 200 en las mismas condiciones donde Yahoo daba 429. Requiere headers `Origin`/`Referer` de nasdaq.com pero no cookie ni crumb.

**Alternativa descartada**: Stooq (`stooq.com/q/d/l/`) — descartada, tiene un challenge JS anti-bot (proof-of-work) que no es viable resolver server-side sin un navegador headless.

**Estado**: CERRADO.

---

## [2026-07-03] Cartera en Vercel: almacenamiento en `/tmp` (efímero), no persistente

**Contexto**: El filesystem del proyecto en funciones serverless de Vercel es de solo lectura salvo `/tmp`, y `/tmp` no sobrevive entre invocaciones ni redeploys.

**Decisión**: `DATA_FILE` apunta a `/tmp/investments.json` cuando `process.env.VERCEL` está presente; a `data/investments.json` en local.

**Por qué**: No había presupuesto/alcance para añadir una base de datos externa (Postgres, Redis, etc.) solo para la cartera. Se documenta la limitación en vez de ocultarla.

**Alternativa descartada**: Añadir Vercel KV/Postgres — descartada por ahora (fuera de alcance de lo pedido); revisar si el usuario quiere persistencia real en producción.

**Estado**: CERRADO (para v1). Reabrir si el usuario pide persistencia de cartera en producción.

---

## [2026-07-03] Calentador de caché en background: solo local, no en Vercel

**Contexto**: `server.js` tenía un `setInterval(warmCaches, 15min)` para pre-poblar la caché de los 19 activos y evitar que la primera visita del día pague el costo de la cola de rate-limit completa.

**Decisión**: Ese `setTimeout`/`setInterval` solo se registra si `!process.env.VERCEL`.

**Por qué**: En serverless no existe un "proceso persistente" entre invocaciones — un timer registrado en una invocación no sobrevive a la respuesta HTTP, y Vercel puede matar la función al terminar el response. Mantenerlo activo ahí no cumple su función y podría generar comportamiento inesperado.

**Alternativa descartada**: Vercel Cron pegándole a `/api/overview` cada N minutos — viable pero fuera de alcance de lo pedido; anotar como mejora futura si el cold-start de producción molesta.

**Estado**: CERRADO.

---

## [2026-07-03] Timeout por activo en `/api/overview`: 45s (subido de 12s)

**Contexto**: Con caché fría (primera petición), la cola serial de rate-limit por fuente (Binance/Coinbase 150ms, NASDAQ 400ms, CoinGecko 2000ms de espaciado entre llamadas) hace que activos al final de la cola no alcancen a resolver dentro de un timeout corto — no es que la fuente falle, es que no le toca turno a tiempo.

**Decisión**: `withTimeout(analyzeAsset(...), 45_000, symbol)` en vez de 12_000. Vercel `maxDuration` de la función es 60s, dejando margen.

**Por qué**: 12s causaba timeouts en cascada (11+ de 19 activos) en frío, no por fallo real de la fuente sino por posición en la cola.

**Alternativa descartada**: Paralelizar más las colas (permitir N concurrentes por fuente en vez de 1) — descartada por ahora para no arriesgar nuevos 429/451 bajo carga real; revisar si 45s deja de ser suficiente.

**Estado**: CERRADO.

---
## [2026-07-03] Agente B: StockTwits + Reddit RSS como sustituto de X/Twitter

**Contexto**: El spec del Core IA pedía monitorear X (Twitter) con cashtags. X no tiene vía gratuita (API de pago desde 2023) y el scraping viola ToS además de estar bloqueado agresivamente; las instancias de Nitter están muertas.

**Decisión**: Sentimiento social = StockTwits (API pública sin key, cashtags de los 19 activos incl. crypto como `BTC.X`, etiquetas Bullish/Bearish nativas de usuarios, detección de picos por mensajes/hora vs baseline EMA persistido) + Reddit vía **RSS** (r/CryptoCurrency, r/stocks). Aprobado por el usuario ante las opciones presentadas.

**Quirk documentado**: El endpoint JSON de Reddit (`/hot.json`) devuelve un muro HTML con challenge JS para cualquier UA no-navegador (probado con varias variantes) — el RSS (`/hot.rss`) sigue abierto.

**Alternativa descartada**: Scraping directo de X — ilegal/frágil; instancias Nitter — muertas.

**Estado**: CERRADO.

---

## [2026-07-03] Agente A: transcripciones de YouTube vía yt-dlp (solo modo local)

**Contexto**: Para análisis profundo (no solo títulos) se necesitan las transcripciones completas. Verificado antes de integrar (driver SDD): (1) el endpoint `timedtext` con las URLs firmadas de la página watch devuelve **HTTP 200 con cuerpo vacío** (exige token POT desde 2024); (2) el endpoint Innertube `get_transcript` (usado por youtubei.js) devuelve **400 Precondition check failed**; (3) el cliente ANDROID de Innertube no lista caption tracks.

**Decisión**: `yt-dlp` como motor de extracción (instalado vía Homebrew; maneja POT correctamente). Salida json3 → ventanas de ~30s → detección de menciones por activo + sentimiento + niveles alegados (objetivos/soportes/resistencias por regex). Cache permanente por vídeo en `data/transcripts/` (una transcripción no cambia). Se prioriza el idioma original del canal (evita falsos neutrales por auto-doblaje).

**Consecuencia**: El análisis profundo de YouTube **solo funciona en modo local** (Vercel no tiene el binario). `/api/intel` lo reporta con `deepYoutubeReason`; el resto del sistema (social + fusión + voz) funciona igual en ambos entornos.

**Alternativa descartada**: youtube-transcript-api / youtubei.js — rotos por el mismo bloqueo de YouTube.

**Estado**: CERRADO.

---

## [2026-07-03] LLM local opcional vía Ollama con degradación limpia

**Contexto**: Sin API keys de pago, la conversación libre y los resúmenes narrativos necesitan un LLM. El usuario tiene Ollama corriendo con varios modelos locales.

**Decisión**: Capa opcional (`lib/ollama.js`): detecta Ollama en `localhost:11434` (cache de 5 min), prefiere `qwen3.5:9b-mlx` > `gemma4:12b-mlx` > `llama3.2`. Si no está: todo el sistema funciona en modo determinista (intents por regex + plantillas con datos vivos). Usos: resumen narrativo del intel + preguntas libres en `/api/voice/ask`.

**Quirk documentado**: Los modelos qwen3.x en Ollama gastan todo `num_predict` en el bloque `<think>` y devuelven respuesta visible vacía — obligatorio enviar `think: false` en la petición.

**Estado**: CERRADO.

---

## [2026-07-03] Fusión de scores: pesos de sentimiento por perfil de activo

**Contexto**: El spec pide que el sentimiento social/YouTube pese más en activos volátiles (crypto) y que el técnico/fundamental pese más en acciones/ETFs.

**Decisión**: `fusedScore = score_base + w_social·social + w_deep·youtubeProfundo` con pesos crypto `{social: 1.0, deep: 1.0}` y stock/etf `{social: 0.4, deep: 0.5}`. Umbrales de acción idénticos al score base (±2). El score base (técnico+fundamental+títulos+F&G) no se recalcula — la fusión es una capa encima.

**Estado**: CERRADO. Ajustar pesos solo con evidencia (falsos positivos repetidos).

---
