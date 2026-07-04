# Learned Rules — Market Analyzer

Reglas aprendidas de sesiones anteriores. Verificar antes de proponer cambios.

<!-- Formato:
## [Regla] — session_n donde se aprendió
- **Trigger**: qué causó el error o aprendizaje
- **Regla**: comportamiento esperado del agente
- **Verify**: comando para validar
- **sessions_ok**: N (contador de sesiones sin violación)
-->

## Una API gratis que funciona en local puede fallar en producción por la IP, no por el código — sesión 2
- **Trigger**: Binance funcionaba en pruebas locales (curl desde esta máquina) pero devolvía 451 en Vercel — el primer diagnóstico razonable (rate limit, retry) no aplicaba.
- **Regla**: si una fuente externa gratis fallará silenciosamente en producción, verificar con `vercel logs <url> --json` el error REAL (agregar `console.warn` temporal si hace falta) antes de asumir que es un rate-limit transitorio. Geo-block (451) y rate-limit (429) requieren fixes distintos.
- **Verify**: `vercel logs https://market-analyzer-delta.vercel.app --json | grep -i "451\|429"`
- **sessions_ok**: 1

## Verificar el handle de YouTube resolviendo channelId real antes de asumir que existe — sesión 2
- **Trigger**: el handle `@JamesRickardsProject` ya no resolvía a un canal válido; había que encontrar el real (`@itmtrading`).
- **Regla**: antes de agregar/cambiar un canal de YouTube en `ANALYSTS`, verificar con `curl -A "Mozilla/5.0" "https://www.youtube.com/@handle" | grep -o '"channelId":"UC[a-zA-Z0-9_-]\{22\}"'` que resuelve a un ID real.
- **Verify**: comando de arriba con el handle en cuestión
- **sessions_ok**: 1

## No confundir "timeout por posición en cola" con "fuente caída" — sesión 2
- **Trigger**: 11 de 19 activos fallaban con timeout a los 12s en `/api/overview`, parecía que las fuentes fallaban cuando en realidad no les tocaba turno aún en la cola serial de rate-limit.
- **Regla**: si varios activos fallan con el mismo tipo de error (timeout) al mismo tiempo, revisar primero el orden/tamaño de la cola de rate-limit antes de sospechar de la fuente externa.
- **Verify**: medir tiempo total de `/api/overview` cold vs timeout configurado por activo
- **sessions_ok**: 1

## Los endpoints web de subtítulos de YouTube están bloqueados — usar yt-dlp — sesión 3
- **Trigger**: timedtext devolvió 200 vacío (POT) e Innertube get_transcript devolvió 400 en todos los vídeos probados; se perdió tiempo con youtubei.js.
- **Regla**: para transcripciones de YouTube ir directo a `yt-dlp --skip-download --write-auto-subs --sub-format json3`. No reintentar los endpoints web.
- **Verify**: `yt-dlp --version`
- **sessions_ok**: 0

## qwen3.x en Ollama devuelve respuesta vacía sin think:false — sesión 3
- **Trigger**: `/api/generate` con qwen3.5:9b-mlx consumió todo num_predict en `<think>` y `response` llegó vacío; parecía fallo del endpoint.
- **Regla**: toda petición a Ollama con modelos qwen3.x lleva `"think": false` en el body.
- **Verify**: `curl -s localhost:11434/api/generate -d '{"model":"qwen3.5:9b-mlx","prompt":"hola","stream":false,"think":false,"options":{"num_predict":20}}' | grep -o '"response":"[^"]*"'`
- **sessions_ok**: 0
