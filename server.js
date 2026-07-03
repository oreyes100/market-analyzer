import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyze, chartSeries } from './lib/indicators.js';
import {
  CRYPTOS, STOCKS, ETFS, ANALYSTS,
  cryptoMarkets, cryptoOhlc, globalCrypto, fearGreed,
  stockChart, channelVideos, cached,
} from './lib/sources.js';
import { analyzeChannel, aggregateSentiment } from './lib/sentiment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_VERCEL = !!process.env.VERCEL;
// En Vercel el filesystem del proyecto es de solo lectura salvo /tmp, y /tmp es efímero
// (no sobrevive entre invocaciones ni despliegues). La cartera solo persiste de verdad
// corriendo el servidor localmente (ver start-mac.command / start-windows.bat).
const DATA_FILE = IS_VERCEL
  ? path.join('/tmp', 'investments.json')
  : path.join(__dirname, 'data', 'investments.json');
const PORT = process.env.PORT || 3117;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------

async function readInvestments() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeInvestments(list) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2));
}

function fundamentalCrypto(m) {
  // m: fila de coins/markets de CoinGecko
  const notes = [];
  let score = 0;
  const athDist = m.ath_change_percentage; // % desde ATH (negativo)
  if (athDist !== null) {
    if (athDist < -50) { score += 1.5; notes.push(`A ${Math.abs(athDist).toFixed(0)}% de su máximo histórico (potencial de recuperación)`); }
    else if (athDist > -10) { score -= 1; notes.push(`Muy cerca de su máximo histórico (${Math.abs(athDist).toFixed(1)}%)`); }
  }
  const volRatio = m.total_volume && m.market_cap ? m.total_volume / m.market_cap : null;
  if (volRatio !== null) {
    if (volRatio > 0.1) { score += 0.5; notes.push('Volumen alto respecto a capitalización (interés fuerte)'); }
    else if (volRatio < 0.02) { score -= 0.5; notes.push('Volumen bajo respecto a capitalización'); }
  }
  if (m.max_supply && m.circulating_supply) {
    const pct = m.circulating_supply / m.max_supply;
    if (pct > 0.9) { score += 0.5; notes.push(`${(pct * 100).toFixed(0)}% del supply ya en circulación (baja inflación futura)`); }
  }
  if (m.market_cap_rank <= 2) { score += 0.5; notes.push(`Top ${m.market_cap_rank} por capitalización (menor riesgo relativo)`); }
  return {
    score: Math.round(score * 10) / 10,
    notes,
    data: {
      marketCap: m.market_cap,
      rank: m.market_cap_rank,
      volume24h: m.total_volume,
      circulatingSupply: m.circulating_supply,
      maxSupply: m.max_supply,
      athChangePct: m.ath_change_percentage,
      change24h: m.price_change_percentage_24h,
      change7d: m.price_change_percentage_7d_in_currency,
      change30d: m.price_change_percentage_30d_in_currency,
    },
  };
}

function fundamentalYahoo(meta, candles) {
  const notes = [];
  let score = 0;
  const price = meta.price;
  if (meta.fiftyTwoWeekHigh && meta.fiftyTwoWeekLow) {
    const range = meta.fiftyTwoWeekHigh - meta.fiftyTwoWeekLow;
    const pos = range > 0 ? (price - meta.fiftyTwoWeekLow) / range : 0.5;
    if (pos < 0.3) { score += 1.5; notes.push(`En el ${(pos * 100).toFixed(0)}% inferior de su rango de 52 semanas (posible infravaloración)`); }
    else if (pos > 0.9) { score -= 0.5; notes.push(`En máximos de 52 semanas (${(pos * 100).toFixed(0)}% del rango)`); }
    else if (pos > 0.6) { score += 0.5; notes.push('Zona alta del rango anual con momento positivo'); }
  }
  // Momento 3 meses
  if (candles.length > 63) {
    const p3m = candles[candles.length - 64].close;
    const chg = ((price - p3m) / p3m) * 100;
    if (chg > 15) { score += 0.5; notes.push(`+${chg.toFixed(1)}% en 3 meses (momento fuerte)`); }
    else if (chg < -15) { score += 0.5; notes.push(`${chg.toFixed(1)}% en 3 meses (castigado, posible rebote)`); }
  }
  return {
    score: Math.round(score * 10) / 10,
    notes,
    data: {
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      currency: meta.currency,
      exchange: meta.exchange,
    },
  };
}

async function analystsReport() {
  return cached('analysts:report', 15 * 60_000, async () => {
    const results = await Promise.allSettled(
      ANALYSTS.map(async a => {
        const videos = await channelVideos(a.handle);
        return { ...a, ...analyzeChannel(videos) };
      })
    );
    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { ...ANALYSTS[i], error: r.reason?.message ?? 'error', videos: [], sentimentScore: 0, sentimentLabel: 'neutral' }
    );
  });
}

async function analyzeAsset(type, item) {
  if (type === 'crypto') {
    const [candles, markets] = await Promise.all([cryptoOhlc(item.id, 365), cryptoMarkets()]);
    const m = markets.find(x => x.id === item.id);
    const technical = analyze(candles);
    const fundamental = m ? fundamentalCrypto(m) : { score: 0, notes: [], data: {} };
    if (m) technical.price = m.current_price; // precio spot más fresco que la última vela
    return { type, id: item.id, symbol: item.symbol, name: item.name, technical, fundamental, candles };
  }
  const { candles, meta } = await stockChart(item.symbol, type);
  const technical = analyze(candles);
  const fundamental = fundamentalYahoo(meta, candles);
  technical.price = meta.price ?? technical.price;
  return { type, id: item.symbol, symbol: item.symbol, name: item.name, technical, fundamental, candles };
}

const ALL_ASSETS = [
  ...CRYPTOS.map(c => ({ type: 'crypto', item: c })),
  ...STOCKS.map(s => ({ type: 'stock', item: s })),
  ...ETFS.map(e => ({ type: 'etf', item: e })),
];

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout: ${label} aún sin datos (reintentando en segundo plano)`)), ms)),
  ]);
}

// Calienta cachés en segundo plano: secuencial y lento para no disparar rate limits
async function warmCaches() {
  for (const { type, item } of ALL_ASSETS) {
    try {
      await analyzeAsset(type, item);
    } catch (e) {
      console.warn(`[warm] ${item.symbol}: ${e.message}`);
    }
  }
  console.log('[warm] ciclo completado');
}
// El calentador en background solo tiene sentido en un proceso persistente (local).
// En Vercel cada invocación es una función efímera: no hay "background" entre requests.
if (!IS_VERCEL) {
  setTimeout(warmCaches, 1000);
  setInterval(warmCaches, 15 * 60_000);
}

// ---------- API ----------

app.get('/api/overview', async (req, res) => {
  try {
    const [fng, global, analysts] = await Promise.all([
      fearGreed().catch(() => null),
      globalCrypto().catch(() => null),
      analystsReport().catch(() => []),
    ]);
    const sentiment = aggregateSentiment(analysts);

    const settled = await Promise.allSettled(
      ALL_ASSETS.map(({ type, item }) => withTimeout(analyzeAsset(type, item), 45_000, item.symbol))
    );
    const assets = [];
    const errors = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === 'fulfilled') assets.push(r.value);
      else errors.push({ asset: ALL_ASSETS[i].item.symbol, error: r.reason?.message });
    }

    const opportunities = assets.map(a => {
      let score = a.technical.technicalScore + a.fundamental.score;
      const reasons = [];
      // Sentimiento de analistas afecta más a crypto (canales mayormente crypto)
      const sentWeight = a.type === 'crypto' ? 1 : 0.4;
      score += sentiment.score * sentWeight;
      if (Math.abs(sentiment.score) >= 0.5) {
        reasons.push(`Sentimiento de analistas: ${sentiment.label} (${sentiment.score > 0 ? '+' : ''}${sentiment.score})`);
      }
      // Fear & Greed contrario para crypto
      if (a.type === 'crypto' && fng) {
        if (fng.value <= 25) { score += 1; reasons.push(`Fear & Greed en miedo extremo (${fng.value}) — señal contraria de compra`); }
        else if (fng.value >= 75) { score -= 1; reasons.push(`Fear & Greed en codicia extrema (${fng.value}) — precaución`); }
      }
      const action = score >= 2 ? 'comprar' : score <= -2 ? 'vender / evitar' : 'mantener / esperar';
      return {
        type: a.type, id: a.id, symbol: a.symbol, name: a.name,
        price: a.technical.price,
        score: Math.round(score * 10) / 10,
        action,
        trend: a.technical.trend,
        rsi: a.technical.rsi,
        trade: a.technical.trade,
        signals: a.technical.signals,
        fundamentalNotes: a.fundamental.notes,
        extraReasons: reasons,
        change24h: a.fundamental.data.change24h ?? null,
      };
    }).sort((x, y) => y.score - x.score);

    res.json({ fearGreed: fng, global, sentiment, analysts: analysts.map(a => ({
      name: a.name, handle: a.handle, url: a.url,
      sentimentScore: a.sentimentScore, sentimentLabel: a.sentimentLabel, error: a.error ?? null,
    })), opportunities, errors, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analysis/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const list = type === 'crypto' ? CRYPTOS : type === 'stock' ? STOCKS : ETFS;
    const item = list.find(x => (x.id ?? x.symbol).toLowerCase() === id.toLowerCase() || x.symbol.toLowerCase() === id.toLowerCase());
    if (!item) return res.status(404).json({ error: 'Activo no encontrado' });
    const a = await analyzeAsset(type, item);
    res.json({
      type: a.type, id: a.id, symbol: a.symbol, name: a.name,
      technical: a.technical, fundamental: a.fundamental,
      series: chartSeries(a.candles),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analysts', async (req, res) => {
  try {
    res.json(await analystsReport());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/assets', (req, res) => {
  res.json({
    crypto: CRYPTOS,
    stock: STOCKS,
    etf: ETFS,
  });
});

// ---------- Registro de inversiones ----------

app.get('/api/investments', async (req, res) => {
  const list = await readInvestments();
  // Enriquecer con precio actual
  const withPrices = await Promise.all(list.map(async inv => {
    let current = null;
    try {
      if (inv.assetType === 'crypto') {
        const markets = await cryptoMarkets();
        current = markets.find(m => m.id === inv.assetId)?.current_price ?? null;
      } else {
        const { meta } = await stockChart(inv.assetId, inv.assetType);
        current = meta.price;
      }
    } catch { /* precio no disponible */ }
    const invested = inv.quantity * inv.buyPrice;
    const value = current !== null ? inv.quantity * current : null;
    return {
      ...inv,
      currentPrice: current,
      invested: Math.round(invested * 100) / 100,
      currentValue: value !== null ? Math.round(value * 100) / 100 : null,
      pnl: value !== null ? Math.round((value - invested) * 100) / 100 : null,
      pnlPct: value !== null && invested > 0 ? Math.round(((value - invested) / invested) * 10000) / 100 : null,
    };
  }));
  res.json(withPrices);
});

app.post('/api/investments', async (req, res) => {
  const { assetType, assetId, symbol, name, quantity, buyPrice, date, notes } = req.body;
  if (!assetType || !assetId || !quantity || !buyPrice) {
    return res.status(400).json({ error: 'Faltan campos: assetType, assetId, quantity, buyPrice' });
  }
  const list = await readInvestments();
  const inv = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    assetType, assetId, symbol: symbol ?? assetId, name: name ?? assetId,
    quantity: Number(quantity), buyPrice: Number(buyPrice),
    date: date || new Date().toISOString().slice(0, 10),
    notes: notes ?? '',
    createdAt: new Date().toISOString(),
  };
  list.push(inv);
  await writeInvestments(list);
  res.status(201).json(inv);
});

app.delete('/api/investments/:id', async (req, res) => {
  const list = await readInvestments();
  const next = list.filter(i => i.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'No encontrado' });
  await writeInvestments(next);
  res.json({ ok: true });
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Market Analyzer en http://localhost:${PORT}`);
  });
}

export default app;
