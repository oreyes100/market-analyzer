# 📊 Market Analyzer

Webapp de análisis de mercado: **criptomonedas** (Bitcoin y principales), **acciones** de la bolsa y **ETFs**. Todo con fuentes de datos gratuitas, sin API keys.

## Ejecutar

```bash
npm install
npm start
# → http://localhost:3117
```

Requiere Node.js ≥ 18. El puerto se puede cambiar con la variable `PORT`.

## Qué hace

### 🎯 Oportunidades (landing)
Ranking de los 19 activos por **score combinado** con acción sugerida (comprar / mantener / vender), puntos de **entrada, objetivo y stop** (basados en soportes y resistencias) y ratio riesgo/beneficio. El score combina:

- **Análisis técnico**: RSI(14), MACD(12,26,9), SMA50/200, Bandas de Bollinger.
- **Chartismo**: tendencia por estructura de máximos/mínimos, soportes y resistencias por clustering de pivotes, doble suelo/techo, cruce dorado/de la muerte.
- **Análisis fundamental**: para crypto — capitalización, ranking, volumen/mcap, supply circulante, distancia al ATH; para acciones/ETFs — posición en rango de 52 semanas y momento a 3 meses.
- **Sentimiento de analistas de YouTube** (ver abajo) + índice **Fear & Greed** como señal contraria.

### 📈 Análisis
Gráfico de velas de 1 año con SMA50/200, paneles de RSI y MACD, y desglose completo técnico + fundamental por activo.

### 🎥 Analistas
Últimos vídeos de José Luis Cava, Satoshi Stacker, J Bravo, Matt Giannino (Market Moves) y James Rickards Project vía RSS de YouTube. Sentimiento estimado por palabras clave (ES/EN) en los títulos, ponderado por recencia.

### 💼 Cartera
Registro de inversiones persistido en `data/investments.json` con precio actual, valor y P&L en vivo.

## Fuentes de datos (gratuitas, sin keys)

| Datos | Fuente | Respaldo |
|---|---|---|
| OHLC crypto | Binance klines | CoinGecko OHLC |
| Metadata crypto (mcap, ATH…) | CoinGecko | — |
| Fear & Greed | alternative.me | — |
| OHLC acciones/ETFs | NASDAQ API | Yahoo Finance |
| Vídeos analistas | RSS de YouTube | — |

Las fuentes gratuitas tienen rate limits estrictos: el servidor usa colas por fuente, reintentos con backoff, caché con TTL (se sirve dato caducado si la fuente falla) y un calentador en segundo plano cada 15 min. La primera carga puede tardar ~1 min en completar los 19 activos; la página se refresca sola.

## Estructura

```
server.js           Express: API + estáticos + calentador de caché
lib/sources.js      Fuentes de datos, colas de rate limit, caché
lib/indicators.js   RSI, MACD, SMA/EMA, Bollinger, pivotes, S/R, patrones
lib/sentiment.js    Sentimiento por keywords de títulos (ES/EN)
public/             Frontend (lightweight-charts vía CDN)
data/               investments.json (registro de cartera)
```

⚠️ Análisis automático con fines informativos. No es asesoramiento financiero.
