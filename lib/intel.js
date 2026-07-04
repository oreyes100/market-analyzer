// Core IA — Orquestador de sub-agentes (A: YouTube profundo, B: social) + fusión + alertas.
// Deposita hallazgos en data/sentiment_deep.json para consumo instantáneo del agente de voz.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ANALYSTS, CRYPTOS, STOCKS, ETFS, channelVideos, cached } from './sources.js';
import { fetchTranscript, analyzeTranscript, plausibleLevels, formatTimestamp, ytDlpAvailable } from './transcripts.js';
import { socialForAsset } from './social.js';
import { labelFor } from './sentiment.js';
import { ollamaStatus, ollamaGenerate } from './ollama.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const INTEL_FILE = path.join(DATA_DIR, 'sentiment_deep.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');

export const ALL_ASSET_IDS = [
  ...CRYPTOS.map(c => ({ id: c.id, symbol: c.symbol, name: c.name, type: 'crypto' })),
  ...STOCKS.map(s => ({ id: s.symbol, symbol: s.symbol, name: s.name, type: 'stock' })),
  ...ETFS.map(e => ({ id: e.symbol, symbol: e.symbol, name: e.name, type: 'etf' })),
];

// ---------- Agente A: YouTube profundo ----------

const VIDEOS_PER_CHANNEL = 2;

async function buildDeepYoutube() {
  if (!(await ytDlpAvailable())) {
    return { available: false, reason: 'yt-dlp no disponible (análisis profundo solo en modo local)', perAsset: {}, perChannel: [] };
  }
  const perAsset = {};
  const perChannel = [];
  const now = Date.now();

  for (const analyst of ANALYSTS) {
    const channelResult = { name: analyst.name, handle: analyst.handle, videos: [] };
    try {
      const videos = (await channelVideos(analyst.handle)).slice(0, VIDEOS_PER_CHANNEL);
      for (const v of videos) {
        try {
          const transcript = await cached(`deep:${v.videoId}`, 24 * 3600_000, async () => {
            const t = await fetchTranscript(v.videoId, analyst.lang);
            return { lang: t.lang, assets: analyzeTranscript(t) };
          });
          const ageDays = (now - new Date(v.published).getTime()) / 86_400_000;
          const weight = Math.max(0.2, 1 - ageDays / 14); // vídeos >2 semanas pesan poco
          channelResult.videos.push({
            videoId: v.videoId, title: v.title, published: v.published, lang: transcript.lang,
            assets: Object.keys(transcript.assets),
          });
          for (const [assetId, a] of Object.entries(transcript.assets)) {
            const agg = perAsset[assetId] ??= {
              mentions: 0, weightedSentiment: 0, totalWeight: 0,
              targets: [], supports: [], resistances: [], sources: [],
            };
            agg.mentions += a.mentions;
            agg.weightedSentiment += a.sentimentScore * weight;
            agg.totalWeight += weight;
            agg.targets.push(...a.targets);
            agg.supports.push(...a.supports);
            agg.resistances.push(...a.resistances);
            agg.sources.push({
              analyst: analyst.name, video: v.title, videoId: v.videoId,
              at: formatTimestamp(a.firstMentionT), sentiment: a.sentimentLabel,
              mentions: a.mentions, quote: a.quotes[0] ?? null,
            });
          }
        } catch (e) {
          channelResult.videos.push({ videoId: v.videoId, title: v.title, error: e.message.slice(0, 100) });
        }
      }
    } catch (e) {
      channelResult.error = e.message;
    }
    perChannel.push(channelResult);
  }

  for (const agg of Object.values(perAsset)) {
    agg.sentimentScore = agg.totalWeight > 0
      ? Math.round((agg.weightedSentiment / agg.totalWeight) * 100) / 100 : 0;
    agg.sentimentLabel = labelFor(agg.sentimentScore);
    delete agg.weightedSentiment;
    delete agg.totalWeight;
  }
  return { available: true, perAsset, perChannel };
}

// ---------- Agente B: social ----------

async function buildSocial() {
  const perAsset = {};
  // Secuencial por diseño: StockTwits tiene cola interna, pero así evitamos ráfagas de 19
  for (const a of ALL_ASSET_IDS) {
    try {
      perAsset[a.id] = await socialForAsset(a.id);
    } catch (e) {
      perAsset[a.id] = { error: e.message, score: 0, spike: false };
    }
  }
  return perAsset;
}

// ---------- Fusión y alertas ----------

// Pesos por perfil de activo: crypto pondera más el sentimiento social/YouTube;
// acciones/ETFs ponderan más su score técnico+fundamental existente.
const WEIGHTS = {
  crypto: { social: 1.0, deep: 1.0 },
  stock: { social: 0.4, deep: 0.5 },
  etf: { social: 0.4, deep: 0.5 },
};

export function fuseRecommendations(opportunities, deep, social) {
  return opportunities.map(o => {
    const w = WEIGHTS[o.type] ?? WEIGHTS.etf;
    const d = deep.perAsset?.[o.id];
    const s = social?.[o.id];
    let fused = o.score;
    const drivers = [];
    if (d && d.mentions > 0) {
      fused += d.sentimentScore * w.deep;
      drivers.push(`YouTube profundo: ${d.sentimentLabel} (${d.mentions} menciones en ${d.sources.length} vídeos)`);
    }
    if (s && !s.error && Math.abs(s.score) >= 0.3) {
      fused += s.score * w.social;
      drivers.push(`Social: ${s.label} (${s.stocktwits?.bullish ?? 0}🐂/${s.stocktwits?.bearish ?? 0}🐻 StockTwits${s.reddit?.mentions ? `, ${s.reddit.mentions} posts Reddit` : ''})`);
    }
    if (s?.spike) {
      drivers.push(`⚡ Pico de volumen de menciones (${s.stocktwits?.msgsPerHour}/h vs baseline ${s.stocktwits?.baseline}/h)`);
    }
    fused = Math.round(fused * 10) / 10;
    const action = fused >= 2 ? 'comprar' : fused <= -2 ? 'vender / evitar' : 'mantener / esperar';
    return {
      ...o,
      fusedScore: fused,
      fusedAction: action,
      intelDrivers: drivers,
      deepYoutube: d ? {
        sentiment: d.sentimentLabel, score: d.sentimentScore, mentions: d.mentions,
        targets: plausibleLevels(d.targets, o.price),
        supports: plausibleLevels(d.supports, o.price),
        resistances: plausibleLevels(d.resistances, o.price),
        sources: d.sources.slice(0, 4),
      } : null,
      social: s && !s.error ? s : null,
    };
  }).sort((a, b) => b.fusedScore - a.fusedScore);
}

async function readAlerts() {
  try { return JSON.parse(await fs.readFile(ALERTS_FILE, 'utf8')); } catch { return { lastId: 0, alerts: [] }; }
}

function fmtP(v) {
  if (v == null) return '';
  return v >= 1000 ? Math.round(v).toLocaleString('es-ES') : String(Math.round(v * 100) / 100);
}

export function generateAlerts(prev, fused, fearGreed, investments) {
  const alerts = [];
  const prevById = new Map((prev?.fused ?? []).map(f => [f.id, f]));

  for (const f of fused) {
    const p = prevById.get(f.id);
    // Cambio de acción (cruce de umbral ±2)
    if (p && p.fusedAction !== f.fusedAction) {
      const dir = f.fusedScore > p.fusedScore ? 'mejora' : 'deteriora';
      alerts.push({
        severity: f.fusedAction === 'comprar' ? 'opportunity' : f.fusedAction.startsWith('vender') ? 'warning' : 'info',
        asset: f.symbol,
        speech: `Alerta de mercado: ${f.name} ${dir} su señal a ${f.fusedAction}, con score combinado de ${f.fusedScore}. ${f.intelDrivers[0] ?? ''} Monitorea el stop calculado en ${fmtP(f.trade?.stop)} dólares.`,
      });
    }
    // Pico social
    if (f.social?.spike && !(p?.social?.spike)) {
      alerts.push({
        severity: 'info',
        asset: f.symbol,
        speech: `Pico de actividad social en ${f.name}: ${f.social.stocktwits.msgsPerHour} mensajes por hora contra un promedio de ${f.social.stocktwits.baseline}. Sentimiento ${f.social.label}. Puede anticipar movimiento.`,
      });
    }
    // Señal contraria: miedo extremo + pánico social + precio cerca de soporte
    if (f.type === 'crypto' && fearGreed?.value <= 25 && (f.social?.score ?? 0) <= -1
        && f.signals?.some(s => s.text?.includes('soporte'))
        && !(p && p._contrarian)) {
      f._contrarian = true;
      alerts.push({
        severity: 'opportunity',
        asset: f.symbol,
        speech: `Señal contraria en ${f.name}: el índice de miedo está en ${fearGreed.value}, miedo extremo, y las redes están en pánico, pero el precio se apoya en soporte validado en ${fmtP(f.trade?.entry)} dólares. Históricamente, zona de acumulación estratégica.`,
      });
    }
    // RSI extremo
    if (f.rsi != null && (f.rsi < 25 || f.rsi > 75) && !(p && p.rsi != null && (p.rsi < 25 || p.rsi > 75))) {
      alerts.push({
        severity: f.rsi < 25 ? 'opportunity' : 'warning',
        asset: f.symbol,
        speech: `${f.name} registra RSI de ${Math.round(f.rsi)}, ${f.rsi < 25 ? 'sobreventa extrema — vigila un posible rebote' : 'sobrecompra extrema — riesgo de corrección'}.`,
      });
    }
  }

  // Cartera: stop o target alcanzado
  const fusedById = new Map(fused.map(f => [f.id, f]));
  for (const inv of investments ?? []) {
    const f = fusedById.get(inv.assetId);
    if (!f || inv.currentPrice == null) continue;
    if (f.trade?.stop && inv.currentPrice <= f.trade.stop) {
      alerts.push({
        severity: 'critical',
        asset: inv.symbol,
        speech: `Alerta de riesgo: tu posición en ${inv.name} tocó el nivel de stop calculado en ${fmtP(f.trade.stop)} dólares. Precio actual ${fmtP(inv.currentPrice)}. Revisa tu gestión de riesgo.`,
      });
    } else if (f.trade?.target && inv.currentPrice >= f.trade.target) {
      alerts.push({
        severity: 'opportunity',
        asset: inv.symbol,
        speech: `Buenas noticias: tu posición en ${inv.name} alcanzó el objetivo calculado de ${fmtP(f.trade.target)} dólares, con ganancia del ${inv.pnlPct} por ciento. Considera asegurar beneficios.`,
      });
    }
  }
  return alerts;
}

// ---------- Ciclo principal ----------

let building = false;

export async function buildIntel({ opportunities, fearGreed, investments }) {
  if (building) throw new Error('Intel ya está construyéndose');
  building = true;
  try {
    const prev = await loadIntel();
    const [deep, social, ollama] = await Promise.all([
      buildDeepYoutube(),
      buildSocial(),
      ollamaStatus(),
    ]);

    const fused = fuseRecommendations(opportunities, deep, social);

    // Resumen narrativo opcional con LLM local
    let llmDigest = null;
    if (ollama.available && deep.available) {
      try {
        const top = fused.slice(0, 5).map(f =>
          `${f.symbol}: score ${f.fusedScore} (${f.fusedAction}), ${f.intelDrivers.join('; ') || 'sin drivers de sentimiento'}`
        ).join('\n');
        llmDigest = await ollamaGenerate(
          `Datos del mercado hoy:\n${top}\n\nEscribe un párrafo breve (3-4 frases, español neutro, tono profesional para leer en voz alta) resumiendo el estado del mercado y la oportunidad más destacada. Sin viñetas ni markdown.`,
          { system: 'Eres un analista de mercados. Respondes solo con el párrafo pedido.', maxTokens: 220 }
        );
      } catch { /* digest opcional */ }
    }

    const intel = {
      generatedAt: new Date().toISOString(),
      ollama: { available: ollama.available, model: ollama.model },
      deepYoutubeAvailable: deep.available,
      deepYoutubeReason: deep.reason ?? null,
      perChannel: deep.perChannel,
      fused,
      llmDigest,
    };
    await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    await fs.writeFile(INTEL_FILE, JSON.stringify(intel));

    // Alertas nuevas
    const newAlerts = generateAlerts(prev, fused, fearGreed, investments);
    if (newAlerts.length) {
      const store = await readAlerts();
      for (const a of newAlerts) {
        store.lastId++;
        store.alerts.push({ id: store.lastId, ts: new Date().toISOString(), ...a });
      }
      store.alerts = store.alerts.slice(-50);
      await fs.writeFile(ALERTS_FILE, JSON.stringify(store));
    }
    return intel;
  } finally {
    building = false;
  }
}

export async function loadIntel() {
  try { return JSON.parse(await fs.readFile(INTEL_FILE, 'utf8')); } catch { return null; }
}

export async function alertsSince(sinceId = 0) {
  const store = await readAlerts();
  return { lastId: store.lastId, alerts: store.alerts.filter(a => a.id > sinceId) };
}

export function isBuilding() {
  return building;
}
