// Sentimiento por keywords sobre títulos de vídeos (ES + EN)

const BULLISH = [
  // EN
  'bull', 'bullish', 'buy', 'buying', 'pump', 'moon', 'rally', 'breakout', 'surge', 'soar',
  'ath', 'all time high', 'all-time high', 'explode', 'parabolic', 'accumulate', 'accumulation',
  'golden cross', 'bottom is in', 'undervalued', 'opportunity', 'massive gains', 'skyrocket',
  'send it', 'higher', 'new highs', 'target hit', 'upside',
  // ES
  'alcista', 'comprar', 'compra', 'subida', 'sube', 'subir', 'suelo', 'rebote', 'rebota',
  'despega', 'despegue', 'máximos', 'maximos', 'oportunidad', 'acumular', 'acumulación',
  'ruptura alcista', 'objetivo alcanzado', 'al alza', 'dispara', 'disparo', 'cohete',
];

const BEARISH = [
  // EN
  'bear', 'bearish', 'sell', 'selling', 'dump', 'crash', 'collapse', 'plunge', 'correction',
  'bubble', 'warning', 'danger', 'top is in', 'overvalued', 'recession', 'crisis', 'panic',
  'death cross', 'breakdown', 'lower', 'new lows', 'downside', 'liquidation', 'capitulation',
  'stay away', 'get out', 'too late',
  // ES
  'bajista', 'vender', 'venta', 'caída', 'caida', 'cae', 'caer', 'desplome', 'desploma',
  'corrección', 'correccion', 'burbuja', 'peligro', 'aviso', 'alerta', 'crisis', 'pánico',
  'panico', 'techo', 'recesión', 'recesion', 'mínimos', 'minimos', 'a la baja', 'hundimiento',
  'cuidado', 'se acabó', 'se acabo',
];

export function scoreTitle(title) {
  const t = ' ' + title.toLowerCase() + ' ';
  let score = 0;
  const matched = [];
  for (const w of BULLISH) {
    if (t.includes(w)) { score += 1; matched.push({ word: w, dir: 'bull' }); }
  }
  for (const w of BEARISH) {
    if (t.includes(w)) { score -= 1; matched.push({ word: w, dir: 'bear' }); }
  }
  return { score, matched };
}

export function labelFor(score) {
  if (score >= 2) return 'muy alcista';
  if (score >= 0.5) return 'alcista';
  if (score <= -2) return 'muy bajista';
  if (score <= -0.5) return 'bajista';
  return 'neutral';
}

// Analiza los vídeos de un canal: score ponderado por recencia (vídeos recientes pesan más)
export function analyzeChannel(videos) {
  const now = Date.now();
  let weighted = 0;
  let totalWeight = 0;
  const scored = videos.map(v => {
    const { score, matched } = scoreTitle(v.title);
    const ageDays = (now - new Date(v.published).getTime()) / 86_400_000;
    const weight = Math.max(0.2, 1 - ageDays / 30); // vídeos > 30 días pesan 0.2
    weighted += score * weight;
    totalWeight += weight;
    return { ...v, score, label: labelFor(score), keywords: matched.map(m => m.word) };
  });
  const avg = totalWeight > 0 ? weighted / totalWeight : 0;
  return {
    videos: scored,
    sentimentScore: Math.round(avg * 100) / 100,
    sentimentLabel: labelFor(avg),
  };
}

// Sentimiento agregado de todos los analistas para un tema (crypto vs mercado general)
export function aggregateSentiment(channels) {
  const valid = channels.filter(c => !c.error);
  if (valid.length === 0) return { score: 0, label: 'neutral' };
  const avg = valid.reduce((a, c) => a + c.sentimentScore, 0) / valid.length;
  return { score: Math.round(avg * 100) / 100, label: labelFor(avg) };
}
