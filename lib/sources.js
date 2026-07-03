// Fuentes de datos gratuitas (sin API keys): CoinGecko, Yahoo Finance, alternative.me, RSS de YouTube

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const cache = new Map();
const inflight = new Map();

export async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      const value = await fn();
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch (e) {
      // Si la fuente falla (rate limit, caída), servir el último dato bueno aunque haya caducado
      if (hit) return hit.value;
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

async function getJsonRetry(url, headers = {}) {
  let lastErr;
  for (const waitMs of [0, 2500, 8000]) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    try {
      return await getJson(url, headers);
    } catch (e) {
      lastErr = e;
      if (!String(e.message).includes('429')) throw e;
    }
  }
  throw lastErr;
}

async function getText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

// ---------- CoinGecko ----------

export const CRYPTOS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
];

export async function cryptoMarkets() {
  return cached('cg:markets', 5 * 60_000, async () => {
    const ids = CRYPTOS.map(c => c.id).join(',');
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h,7d,30d`;
    return cgQueued(() => getJsonRetry(url));
  });
}

// OHLC diario desde Coinbase Exchange (sin key, sin bloqueo geográfico en EE.UU.
// a diferencia de Binance, que devuelve HTTP 451 desde IPs de nubes en US);
// fallback a CoinGecko si Coinbase falla.
const COINBASE_PRODUCT = {
  bitcoin: 'BTC-USD', ethereum: 'ETH-USD', solana: 'SOL-USD',
  binancecoin: 'BNB-USD', ripple: 'XRP-USD', cardano: 'ADA-USD',
};

export async function cryptoOhlc(id, days = 365) {
  return cached(`ohlc:${id}:${days}`, 10 * 60_000, async () => {
    const product = COINBASE_PRODUCT[id];
    if (product) {
      try {
        const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400`;
        const raw = await coinbaseQueued(() => getJsonRetry(url));
        return raw
          .map(([t, low, high, open, close, volume]) => ({
            time: t, open, high, low, close, volume,
          }))
          .sort((a, b) => a.time - b.time);
      } catch (e) {
        console.warn(`[coinbase] ${product} falló, fallback a CoinGecko: ${e.message}`);
      }
    }
    const cgDays = days > 180 ? 365 : 180;
    const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${cgDays}`;
    const raw = await cgQueued(() => getJsonRetry(url));
    return raw.map(([t, o, h, l, c]) => ({
      time: Math.floor(t / 1000),
      open: o, high: h, low: l, close: c, volume: 0,
    }));
  });
}

export async function globalCrypto() {
  return cached('cg:global', 10 * 60_000, async () => {
    const { data } = await cgQueued(() => getJsonRetry('https://api.coingecko.com/api/v3/global'));
    return {
      btcDominance: data.market_cap_percentage?.btc ?? null,
      totalMarketCap: data.total_market_cap?.usd ?? null,
      marketCapChange24h: data.market_cap_change_percentage_24h_usd ?? null,
    };
  });
}

export async function fearGreed() {
  return cached('fng', 30 * 60_000, async () => {
    const { data } = await getJson('https://api.alternative.me/fng/?limit=1');
    return { value: Number(data[0].value), label: data[0].value_classification };
  });
}

// ---------- Yahoo Finance ----------

export const STOCKS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
];

export const ETFS = [
  { symbol: 'SPY', name: 'SPDR S&P 500' },
  { symbol: 'QQQ', name: 'Invesco QQQ (Nasdaq 100)' },
  { symbol: 'VTI', name: 'Vanguard Total Market' },
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury' },
];

// Las APIs gratis limitan ráfagas: cola secuencial con espaciado por fuente
function makeQueue(gapMs) {
  let chain = Promise.resolve();
  return function queued(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => new Promise(r => setTimeout(r, gapMs)),
      () => new Promise(r => setTimeout(r, gapMs))
    );
    return run;
  };
}

const yahooQueued = makeQueue(1500);
const cgQueued = makeQueue(2000);
const coinbaseQueued = makeQueue(150);
const nasdaqQueued = makeQueue(400);

// Cookie de sesión de Yahoo: reduce la probabilidad de 429
async function yahooCookie() {
  return cached('yf:cookie', 4 * 60 * 60_000, async () => {
    try {
      const res = await fetch('https://fc.yahoo.com', {
        headers: { 'User-Agent': UA },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      return res.headers.get('set-cookie')?.split(';')[0] ?? '';
    } catch {
      return '';
    }
  });
}

async function yahooJson(url) {
  const cookie = await yahooCookie();
  const headers = cookie ? { Cookie: cookie } : {};
  let lastErr;
  for (const waitMs of [0, 3000, 10_000]) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    try {
      return await getJson(url, headers);
    } catch (e) {
      lastErr = e;
      if (!String(e.message).includes('429')) throw e;
    }
  }
  throw lastErr;
}

export async function yahooChart(symbol, range = '1y', interval = '1d') {
  return cached(`yf:${symbol}:${range}:${interval}`, 10 * 60_000, async () => {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const json = await yahooQueued(() => yahooJson(url));
    const result = json.chart?.result?.[0];
    if (!result) throw new Error(`Sin datos de Yahoo para ${symbol}`);
    const { timestamp = [], indicators, meta } = result;
    const q = indicators.quote[0];
    const candles = [];
    for (let i = 0; i < timestamp.length; i++) {
      if (q.close[i] == null || q.open[i] == null) continue;
      candles.push({
        time: timestamp[i],
        open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
        volume: q.volume[i] ?? 0,
      });
    }
    return {
      candles,
      meta: {
        price: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose,
        currency: meta.currency,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
        longName: meta.longName ?? symbol,
        exchange: meta.fullExchangeName ?? '',
      },
    };
  });
}

// ---------- NASDAQ (fuente primaria de acciones/ETFs; Yahoo de respaldo) ----------

const NASDAQ_HEADERS = {
  Accept: 'application/json',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

function parseNum(s) {
  const n = Number(String(s ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function nasdaqChart(symbol, assetclass = 'stocks') {
  return cached(`nq:${symbol}`, 10 * 60_000, async () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 370 * 86_400_000).toISOString().slice(0, 10);
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&fromdate=${from}&todate=${to}&limit=9999`;
    const json = await nasdaqQueued(() => getJsonRetry(url, NASDAQ_HEADERS));
    const rows = json?.data?.tradesTable?.rows ?? [];
    if (!rows.length) throw new Error(`Sin datos de NASDAQ para ${symbol}`);
    const candles = rows
      .map(r => {
        const [m, d, y] = r.date.split('/').map(Number);
        return {
          time: Math.floor(Date.UTC(y, m - 1, d, 12) / 1000),
          open: parseNum(r.open), high: parseNum(r.high), low: parseNum(r.low),
          close: parseNum(r.close), volume: parseNum(r.volume) ?? 0,
        };
      })
      .filter(c => c.close !== null && c.open !== null)
      .reverse(); // NASDAQ devuelve del más reciente al más antiguo
    const highs = candles.map(c => c.high).filter(v => v !== null);
    const lows = candles.map(c => c.low).filter(v => v !== null);
    return {
      candles,
      meta: {
        price: candles[candles.length - 1].close,
        previousClose: candles.length > 1 ? candles[candles.length - 2].close : null,
        currency: 'USD',
        fiftyTwoWeekHigh: highs.length ? Math.max(...highs) : null,
        fiftyTwoWeekLow: lows.length ? Math.min(...lows) : null,
        longName: symbol,
        exchange: 'NASDAQ/NYSE',
      },
    };
  });
}

// Acciones/ETFs: NASDAQ primero, Yahoo como respaldo
export async function stockChart(symbol, kind = 'stock') {
  try {
    return await nasdaqChart(symbol, kind === 'etf' ? 'etf' : 'stocks');
  } catch {
    return yahooChart(symbol, '1y', '1d');
  }
}

// ---------- YouTube (RSS, sin API key) ----------

export const ANALYSTS = [
  { handle: 'JoseLuisCavatv', name: 'José Luis Cava', lang: 'es', url: 'https://www.youtube.com/@JoseLuisCavatv' },
  { handle: 'satoshistackerES', name: 'Satoshi Stacker', lang: 'es', url: 'https://www.youtube.com/@satoshistackerES' },
  { handle: 'J_Bravo', name: 'J Bravo', lang: 'en', url: 'https://www.youtube.com/@J_Bravo' },
  { handle: 'MarketMoves', name: 'Matt Giannino (Market Moves)', lang: 'en', url: 'https://www.youtube.com/@MarketMoves' },
  { handle: 'itmtrading', name: 'James Rickards (ITM Trading)', lang: 'en', url: 'https://www.youtube.com/@itmtrading' },
];

async function resolveChannelId(handle) {
  return cached(`yt:id:${handle}`, 24 * 60 * 60_000, async () => {
    const html = await getText(`https://www.youtube.com/@${handle}`, { 'Accept-Language': 'en' });
    const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/);
    if (!m) throw new Error(`No se pudo resolver channelId de @${handle}`);
    return m[1];
  });
}

function parseRss(xml) {
  const entries = [];
  const blocks = xml.split('<entry>').slice(1);
  for (const b of blocks) {
    const title = b.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const videoId = b.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] ?? '';
    const published = b.match(/<published>(.*?)<\/published>/)?.[1] ?? '';
    const views = b.match(/views="(\d+)"/)?.[1];
    entries.push({
      title: decodeEntities(title),
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      published,
      views: views ? Number(views) : null,
    });
  }
  return entries;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function channelVideos(handle) {
  return cached(`yt:rss:${handle}`, 30 * 60_000, async () => {
    const channelId = await resolveChannelId(handle);
    const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    return parseRss(xml).slice(0, 10);
  });
}
