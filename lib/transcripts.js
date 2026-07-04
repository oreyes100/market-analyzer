// Agente A — Extractor Multimedia (YouTube Deep Insights)
// Extrae transcripciones completas con yt-dlp (los endpoints web de YouTube exigen token POT
// y devuelven vacío/400 — ver Decision Journal). Solo disponible en modo local.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { detectAssets, ASSET_ALIASES } from './aliases.js';
import { scoreTitle, labelFor } from './sentiment.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.VERCEL
  ? path.join('/tmp', 'transcripts')
  : path.join(__dirname, '..', 'data', 'transcripts');

let ytDlpChecked = null;

export async function ytDlpAvailable() {
  if (ytDlpChecked !== null) return ytDlpChecked;
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 10_000 });
    ytDlpChecked = true;
  } catch {
    ytDlpChecked = false;
  }
  return ytDlpChecked;
}

// Descarga la transcripción de un vídeo (json3) y la reduce a ventanas de texto con timestamp.
// Cachea en disco: la transcripción de un vídeo no cambia.
export async function fetchTranscript(videoId, preferLang = 'es') {
  const cacheFile = path.join(CACHE_DIR, `${videoId}.json`);
  try {
    return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch { /* no cacheado aún */ }

  if (!(await ytDlpAvailable())) throw new Error('yt-dlp no disponible (solo modo local)');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-'));
  try {
    // Prioriza el idioma original del canal; pide ambos por si solo existe uno
    const langs = preferLang === 'en' ? 'en.*,es.*' : 'es.*,en.*';
    await execFileAsync('yt-dlp', [
      '--skip-download', '--write-auto-subs', '--write-subs',
      '--sub-langs', langs, '--sub-format', 'json3',
      '-o', path.join(tmpDir, '%(id)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 90_000 }).catch(e => {
      // yt-dlp sale con error si uno de los idiomas falla aunque el otro se haya descargado
      if (!String(e.message).includes('Writing video subtitles')) {
        // seguir: comprobamos abajo si algún archivo llegó
      }
    });

    const files = (await fs.readdir(tmpDir)).filter(f => f.endsWith('.json3'));
    if (!files.length) throw new Error(`Sin subtítulos disponibles para ${videoId}`);
    // Elegir el idioma preferido si está
    const pick = files.find(f => f.includes(`.${preferLang}`)) ?? files[0];
    const lang = pick.match(/\.([a-z]{2}(?:-[A-Za-z]+)?)\.json3$/)?.[1] ?? 'unknown';
    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, pick), 'utf8'));

    // json3 → ventanas de ~30s de texto corrido
    const events = (raw.events ?? []).filter(e => e.segs);
    const windows = [];
    let current = { t: 0, text: '' };
    for (const e of events) {
      const t = Math.floor((e.tStartMs ?? 0) / 1000);
      const text = e.segs.map(s => s.utf8).join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      if (t - current.t >= 30 && current.text) {
        windows.push(current);
        current = { t, text: '' };
      }
      current.text += ' ' + text;
    }
    if (current.text) windows.push(current);

    const result = { videoId, lang, windows: windows.map(w => ({ t: w.t, text: w.text.trim() })) };
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(result));
    return result;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

const SPONSOR_RE = /patrocin|sponsor|promo\b|código de descuento|discount code|affiliate|suscríbete|subscribe|like y|dale like|campanita/i;
const TARGET_RE = /(objetivo|target|apunta|llegar[áa]?\s+a|alcanzar|hasta los|price target|going to|hit)/i;
const SUPPORT_RE = /(soporte|support|suelo|floor|piso)/i;
const RESIST_RE = /(resistencia|resistance|techo|ceiling)/i;

// Extrae números que parecen precios de un texto ("61.000", "$3,500", "100k")
function extractPrices(text) {
  const out = [];
  const re = /\$?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)\s?(k|mil)?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    let numStr = m[1];
    // Normalizar separadores: si hay grupos de 3, son miles
    if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(numStr)) {
      const parts = numStr.split(/[.,]/);
      const last = parts[parts.length - 1];
      if (last.length !== 3) {
        numStr = parts.slice(0, -1).join('') + '.' + last;
      } else {
        numStr = parts.join('');
      }
    } else {
      numStr = numStr.replace(',', '.');
    }
    let n = Number(numStr);
    if (m[2]) n *= 1000;
    if (Number.isFinite(n) && n > 0.001) out.push(n);
  }
  return out;
}

// Analiza las ventanas de una transcripción: menciones por activo, sesgo, niveles alegados.
export function analyzeTranscript(transcript) {
  const assets = {};
  for (const w of transcript.windows) {
    if (w.t < 45) continue;               // paja de introducción
    if (SPONSOR_RE.test(w.text)) continue; // patrocinios
    const mentioned = detectAssets(w.text);
    if (!mentioned.length) continue;
    const { score } = scoreTitle(w.text);
    const prices = extractPrices(w.text);
    for (const id of mentioned) {
      const a = assets[id] ??= {
        mentions: 0, sentimentSum: 0, firstMentionT: w.t,
        targets: [], supports: [], resistances: [], quotes: [],
      };
      a.mentions++;
      a.sentimentSum += score;
      if (prices.length) {
        if (TARGET_RE.test(w.text)) a.targets.push(...prices);
        if (SUPPORT_RE.test(w.text)) a.supports.push(...prices);
        if (RESIST_RE.test(w.text)) a.resistances.push(...prices);
      }
      if (a.quotes.length < 2 && Math.abs(score) >= 2) {
        a.quotes.push(w.text.slice(0, 220));
      }
    }
  }
  // Resumen por activo
  for (const [id, a] of Object.entries(assets)) {
    a.sentimentScore = Math.round((a.sentimentSum / a.mentions) * 100) / 100;
    a.sentimentLabel = labelFor(a.sentimentScore);
    delete a.sentimentSum;
    // Filtrar niveles absurdos se hace en la fusión (donde conocemos el precio actual)
    a.targets = dedupe(a.targets).slice(0, 5);
    a.supports = dedupe(a.supports).slice(0, 5);
    a.resistances = dedupe(a.resistances).slice(0, 5);
  }
  return assets;
}

function dedupe(arr) {
  return [...new Set(arr.map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);
}

// Filtra niveles alegados a los plausibles para el precio actual del activo (0.3x – 4x)
export function plausibleLevels(levels, currentPrice) {
  if (!currentPrice) return levels;
  return levels.filter(v => v >= currentPrice * 0.3 && v <= currentPrice * 4);
}

export function formatTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
