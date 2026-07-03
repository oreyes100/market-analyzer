// Indicadores técnicos calculados sobre arrays de velas { time, open, high, low, close, volume }

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) {
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  const firstIdx = macdLine.findIndex(v => v !== null);
  const valid = macdLine.slice(firstIdx);
  const signalValid = ema(valid, signalPeriod);
  const signal = new Array(firstIdx).fill(null).concat(signalValid);
  const histogram = macdLine.map((v, i) =>
    v !== null && signal[i] !== null ? v - signal[i] : null
  );
  return { macdLine, signal, histogram };
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - mid[i]) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, mid, lower };
}

// Pivotes tipo fractal: máximo/mínimo local con `wing` velas a cada lado
function pivots(candles, wing = 3) {
  const highs = [], lows = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ i, price: candles[i].high });
    if (isLow) lows.push({ i, price: candles[i].low });
  }
  return { highs, lows };
}

// Agrupa pivotes cercanos (< tolerancia %) en niveles; devuelve niveles ordenados por toques
function clusterLevels(points, tolerancePct) {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && (p.price - last.max) / last.max < tolerancePct) {
      last.prices.push(p.price);
      last.max = p.price;
    } else {
      clusters.push({ prices: [p.price], max: p.price });
    }
  }
  return clusters
    .map(c => ({
      price: c.prices.reduce((a, b) => a + b, 0) / c.prices.length,
      touches: c.prices.length,
    }))
    .sort((a, b) => b.touches - a.touches);
}

export function supportResistance(candles, currentPrice) {
  const { highs, lows } = pivots(candles);
  const tolerance = 0.015;
  const levels = clusterLevels([...highs, ...lows], tolerance);
  const supports = levels.filter(l => l.price < currentPrice).sort((a, b) => b.price - a.price);
  const resistances = levels.filter(l => l.price > currentPrice).sort((a, b) => a.price - b.price);
  return {
    supports: supports.slice(0, 3),
    resistances: resistances.slice(0, 3),
  };
}

// Chartismo básico: tendencia por estructura de pivotes + medias
export function chartPattern(candles, closes) {
  const { highs, lows } = pivots(candles);
  const patterns = [];
  const lastHighs = highs.slice(-3).map(p => p.price);
  const lastLows = lows.slice(-3).map(p => p.price);

  let trend = 'lateral';
  if (lastHighs.length >= 2 && lastLows.length >= 2) {
    const hh = lastHighs[lastHighs.length - 1] > lastHighs[lastHighs.length - 2];
    const hl = lastLows[lastLows.length - 1] > lastLows[lastLows.length - 2];
    const lh = lastHighs[lastHighs.length - 1] < lastHighs[lastHighs.length - 2];
    const ll = lastLows[lastLows.length - 1] < lastLows[lastLows.length - 2];
    if (hh && hl) { trend = 'alcista'; patterns.push('Máximos y mínimos crecientes (tendencia alcista)'); }
    else if (lh && ll) { trend = 'bajista'; patterns.push('Máximos y mínimos decrecientes (tendencia bajista)'); }
  }

  // Doble suelo: dos mínimos recientes casi iguales (±2%)
  if (lastLows.length >= 2) {
    const [a, b] = lastLows.slice(-2);
    if (Math.abs(a - b) / a < 0.02 && trend !== 'alcista') {
      patterns.push('Posible doble suelo');
    }
  }
  // Doble techo
  if (lastHighs.length >= 2) {
    const [a, b] = lastHighs.slice(-2);
    if (Math.abs(a - b) / a < 0.02 && trend !== 'bajista') {
      patterns.push('Posible doble techo');
    }
  }

  // Cruce dorado / de la muerte (SMA50 vs SMA200 si hay datos; si no, 20 vs 50)
  const shortP = closes.length >= 220 ? 50 : 20;
  const longP = closes.length >= 220 ? 200 : 50;
  const s = sma(closes, shortP);
  const l = sma(closes, longP);
  const n = closes.length - 1;
  if (s[n] !== null && l[n] !== null && s[n - 1] !== null && l[n - 1] !== null) {
    if (s[n] > l[n] && s[n - 1] <= l[n - 1]) patterns.push(`Cruce dorado (SMA${shortP} cruza sobre SMA${longP})`);
    if (s[n] < l[n] && s[n - 1] >= l[n - 1]) patterns.push(`Cruce de la muerte (SMA${shortP} cruza bajo SMA${longP})`);
  }

  return { trend, patterns, smaShort: s[n], smaLong: l[n], smaShortPeriod: shortP, smaLongPeriod: longP };
}

// Análisis técnico completo de un activo
export function analyze(candles) {
  const closes = candles.map(c => c.close);
  const n = closes.length - 1;
  const price = closes[n];

  const rsiArr = rsi(closes);
  const { macdLine, signal, histogram } = macd(closes);
  const boll = bollinger(closes);
  const sr = supportResistance(candles, price);
  const chart = chartPattern(candles, closes);

  const signals = [];
  let score = 0;

  const rsiNow = rsiArr[n];
  if (rsiNow !== null) {
    if (rsiNow < 30) { score += 2; signals.push({ type: 'compra', text: `RSI en sobreventa (${rsiNow.toFixed(1)})` }); }
    else if (rsiNow < 40) { score += 1; signals.push({ type: 'compra', text: `RSI bajo (${rsiNow.toFixed(1)})` }); }
    else if (rsiNow > 70) { score -= 2; signals.push({ type: 'venta', text: `RSI en sobrecompra (${rsiNow.toFixed(1)})` }); }
    else if (rsiNow > 60) { score -= 1; signals.push({ type: 'venta', text: `RSI alto (${rsiNow.toFixed(1)})` }); }
  }

  if (histogram[n] !== null && histogram[n - 1] !== null) {
    if (histogram[n] > 0 && histogram[n - 1] <= 0) { score += 2; signals.push({ type: 'compra', text: 'Cruce alcista de MACD' }); }
    else if (histogram[n] < 0 && histogram[n - 1] >= 0) { score -= 2; signals.push({ type: 'venta', text: 'Cruce bajista de MACD' }); }
    else if (histogram[n] > 0) { score += 0.5; }
    else { score -= 0.5; }
  }

  if (chart.trend === 'alcista') score += 1;
  if (chart.trend === 'bajista') score -= 1;
  if (chart.smaShort !== null && chart.smaLong !== null) {
    if (price > chart.smaShort && chart.smaShort > chart.smaLong) {
      score += 1;
      signals.push({ type: 'compra', text: `Precio sobre SMA${chart.smaShortPeriod} > SMA${chart.smaLongPeriod} (estructura alcista)` });
    } else if (price < chart.smaShort && chart.smaShort < chart.smaLong) {
      score -= 1;
      signals.push({ type: 'venta', text: `Precio bajo SMA${chart.smaShortPeriod} < SMA${chart.smaLongPeriod} (estructura bajista)` });
    }
  }

  if (boll.lower[n] !== null) {
    if (price <= boll.lower[n] * 1.01) { score += 1; signals.push({ type: 'compra', text: 'Precio en banda inferior de Bollinger' }); }
    if (price >= boll.upper[n] * 0.99) { score -= 1; signals.push({ type: 'venta', text: 'Precio en banda superior de Bollinger' }); }
  }

  const nearestSupport = sr.supports[0]?.price ?? null;
  const nearestResistance = sr.resistances[0]?.price ?? null;
  if (nearestSupport && (price - nearestSupport) / price < 0.03) {
    score += 1;
    signals.push({ type: 'compra', text: `Precio cerca de soporte (${fmt(nearestSupport)})` });
  }
  if (nearestResistance && (nearestResistance - price) / price < 0.03) {
    score -= 1;
    signals.push({ type: 'venta', text: `Precio cerca de resistencia (${fmt(nearestResistance)})` });
  }

  for (const p of chart.patterns) {
    if (p.includes('doble suelo') || p.includes('dorado')) { score += 1.5; signals.push({ type: 'compra', text: p }); }
    else if (p.includes('doble techo') || p.includes('muerte')) { score -= 1.5; signals.push({ type: 'venta', text: p }); }
    else signals.push({ type: 'info', text: p });
  }

  // Entrada/salida/stop
  const entry = nearestSupport && (price - nearestSupport) / price < 0.05 ? nearestSupport : price;
  const target = nearestResistance ?? price * 1.15;
  const stop = nearestSupport ? nearestSupport * 0.97 : price * 0.93;
  const riskReward = (target - entry) / Math.max(entry - stop, entry * 0.001);

  return {
    price,
    rsi: rsiNow,
    macd: { value: macdLine[n], signal: signal[n], histogram: histogram[n] },
    bollinger: { upper: boll.upper[n], mid: boll.mid[n], lower: boll.lower[n] },
    smaShort: chart.smaShort,
    smaLong: chart.smaLong,
    smaShortPeriod: chart.smaShortPeriod,
    smaLongPeriod: chart.smaLongPeriod,
    trend: chart.trend,
    patterns: chart.patterns,
    supports: sr.supports,
    resistances: sr.resistances,
    signals,
    technicalScore: Math.round(score * 10) / 10,
    trade: {
      entry: round(entry),
      target: round(target),
      stop: round(stop),
      riskReward: Math.round(riskReward * 100) / 100,
    },
  };
}

function round(v) {
  if (v >= 1000) return Math.round(v * 100) / 100;
  if (v >= 1) return Math.round(v * 10000) / 10000;
  return Math.round(v * 1e6) / 1e6;
}

function fmt(v) {
  return v >= 1000 ? v.toLocaleString('es-ES', { maximumFractionDigits: 0 }) : String(round(v));
}

// Series para el gráfico del frontend
export function chartSeries(candles) {
  const closes = candles.map(c => c.close);
  const times = candles.map(c => c.time);
  const shortP = closes.length >= 220 ? 50 : 20;
  const longP = closes.length >= 220 ? 200 : 50;
  const s = sma(closes, shortP);
  const l = sma(closes, longP);
  const r = rsi(closes);
  const { macdLine, signal, histogram } = macd(closes);
  const zip = arr => times.map((t, i) => ({ time: t, value: arr[i] })).filter(p => p.value !== null);
  return {
    candles: candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })),
    smaShort: zip(s),
    smaLong: zip(l),
    smaShortPeriod: shortP,
    smaLongPeriod: longP,
    rsi: zip(r),
    macd: zip(macdLine),
    macdSignal: zip(signal),
    macdHistogram: zip(histogram),
  };
}
