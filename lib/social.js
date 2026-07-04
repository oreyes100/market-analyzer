// Agente B — Investigador de Tendencias Sociales
// X/Twitter no tiene vía gratuita ni legal (API de pago, scraping viola ToS) — ver Decision Journal.
// Sustitutos: StockTwits (cashtags con sentimiento Bullish/Bearish nativo) + Reddit vía RSS
// (el endpoint JSON de Reddit devuelve muro HTML desde 2026; el RSS sigue abierto).

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { cached } from './sources.js';
import { ASSET_ALIASES, detectAssets } from './aliases.js';
import { scoreTitle, labelFor } from './sentiment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = process.env.VERCEL
  ? path.join('/tmp', 'social_baseline.json')
  : path.join(__dirname, '..', 'data', 'social_baseline.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Cola simple para StockTwits (límite no documentado; ~200/h sin auth)
let stChain = Promise.resolve();
function stQueued(fn) {
  const run = stChain.then(fn, fn);
  stChain = run.then(
    () => new Promise(r => setTimeout(r, 500)),
    () => new Promise(r => setTimeout(r, 500))
  );
  return run;
}

// ---------- StockTwits ----------

export async function stockTwitsStream(assetId) {
  const sym = ASSET_ALIASES[assetId]?.st;
  if (!sym) throw new Error(`Sin símbolo StockTwits para ${assetId}`);
  return cached(`st:${sym}`, 10 * 60_000, () => stQueued(async () => {
    const res = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${sym}.json`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`StockTwits HTTP ${res.status} para ${sym}`);
    const json = await res.json();
    const messages = json.messages ?? [];
    const now = Date.now();
    let bullish = 0, bearish = 0, last24h = 0;
    const topMessages = [];
    for (const m of messages) {
      const s = m.entities?.sentiment?.basic;
      if (s === 'Bullish') bullish++;
      else if (s === 'Bearish') bearish++;
      const age = now - new Date(m.created_at).getTime();
      if (age < 24 * 3600_000) last24h++;
      if (topMessages.length < 3 && s && (m.likes?.total ?? 0) > 0) {
        topMessages.push({ body: String(m.body).slice(0, 180), sentiment: s, likes: m.likes.total });
      }
    }
    // El stream trae ~30 mensajes; la "velocidad" real es cuánto abarcan en tiempo
    const oldest = messages.length ? new Date(messages[messages.length - 1].created_at).getTime() : now;
    const spanHours = Math.max((now - oldest) / 3600_000, 0.1);
    return {
      symbol: sym,
      sampleSize: messages.length,
      bullish, bearish,
      msgsPerHour: Math.round((messages.length / spanHours) * 10) / 10,
      last24h,
      topMessages,
    };
  }));
}

// Detección de picos: compara msgsPerHour contra baseline móvil persistido
async function readBaselines() {
  try { return JSON.parse(await fs.readFile(BASELINE_FILE, 'utf8')); } catch { return {}; }
}

export async function updateBaselineAndDetectSpike(assetId, msgsPerHour) {
  const baselines = await readBaselines();
  const b = baselines[assetId] ?? { avg: msgsPerHour, n: 0 };
  const spike = b.n >= 3 && msgsPerHour > b.avg * 1.8 && msgsPerHour > 5;
  // Media móvil exponencial lenta para que un pico no contamine el baseline de inmediato
  b.avg = b.avg * 0.8 + msgsPerHour * 0.2;
  b.n = Math.min(b.n + 1, 100);
  baselines[assetId] = b;
  await fs.mkdir(path.dirname(BASELINE_FILE), { recursive: true }).catch(() => {});
  await fs.writeFile(BASELINE_FILE, JSON.stringify(baselines)).catch(() => {});
  return { spike, baseline: Math.round(b.avg * 10) / 10 };
}

// ---------- Reddit (RSS) ----------

const SUBREDDITS = ['CryptoCurrency', 'stocks'];

function parseRedditRss(xml) {
  const entries = [];
  for (const block of xml.split('<entry>').slice(1)) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const link = block.match(/<link href="([^"]+)"/)?.[1] ?? '';
    entries.push({
      title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      link,
    });
  }
  return entries;
}

export async function redditHot() {
  return cached('reddit:hot', 15 * 60_000, async () => {
    const all = [];
    for (const sub of SUBREDDITS) {
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/hot.rss?limit=25`, {
          headers: { 'User-Agent': 'market-analyzer:v1 (personal)' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) continue;
        const entries = parseRedditRss(await res.text());
        for (const e of entries) all.push({ ...e, sub });
      } catch { /* subreddit caído: seguir con el resto */ }
    }
    return all;
  });
}

// ---------- Agregado por activo ----------

export async function socialForAsset(assetId) {
  const [st, reddit] = await Promise.all([
    stockTwitsStream(assetId).catch(e => ({ error: e.message })),
    redditHot().catch(() => []),
  ]);

  const redditPosts = reddit.filter(p => detectAssets(p.title).includes(assetId));
  let redditSentiment = 0;
  for (const p of redditPosts) redditSentiment += scoreTitle(p.title).score;

  let score = 0;
  let spike = false, baseline = null;
  if (!st.error) {
    const rated = st.bullish + st.bearish;
    if (rated >= 5) {
      // ratio alcista normalizado a [-2, +2]
      score += ((st.bullish - st.bearish) / rated) * 2;
    }
    const spikeInfo = await updateBaselineAndDetectSpike(assetId, st.msgsPerHour);
    spike = spikeInfo.spike;
    baseline = spikeInfo.baseline;
  }
  if (redditPosts.length) {
    score += Math.max(-1, Math.min(1, redditSentiment / redditPosts.length));
  }
  score = Math.round(score * 100) / 100;

  return {
    stocktwits: st.error ? { error: st.error } : {
      bullish: st.bullish, bearish: st.bearish,
      msgsPerHour: st.msgsPerHour, baseline, spike,
      topMessages: st.topMessages,
    },
    reddit: {
      mentions: redditPosts.length,
      titles: redditPosts.slice(0, 3).map(p => p.title),
    },
    score,
    label: labelFor(score),
    spike,
  };
}
