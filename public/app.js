// Market Analyzer — frontend

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ---------- Tabs ----------

$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    // Reajustar gráficos al hacerse visibles (creados con la pestaña oculta)
    if (btn.dataset.tab === 'analisis') {
      requestAnimationFrame(() => charts.forEach(c => c.timeScale().fitContent()));
    }
  });
});

// ---------- Formato ----------

function fmtPrice(v) {
  if (v == null) return '—';
  if (v >= 1000) return '$' + v.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  if (v >= 1) return '$' + v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return '$' + v.toLocaleString('es-ES', { maximumFractionDigits: 6 });
}

function fmtBig(v) {
  if (v == null) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + ' B';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + ' mM';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + ' M';
  return '$' + v.toLocaleString('es-ES');
}

function fmtPct(v, decimals = 2) {
  if (v == null) return '—';
  const s = v > 0 ? '+' : '';
  return s + v.toFixed(decimals) + '%';
}

const TYPE_LABEL = { crypto: 'Crypto', stock: 'Acción', etf: 'ETF' };

// ---------- Oportunidades (landing) ----------

let overviewData = null;

async function loadOverview() {
  try {
    const res = await fetch('/api/overview');
    overviewData = await res.json();
    renderBadges(overviewData);
    renderOpportunities(overviewData);
    // Si faltan activos (fuentes aún calentando), reintentar en 30s
    if (overviewData.errors?.length > 0) setTimeout(loadOverview, 30_000);
  } catch (e) {
    $('#opportunities').innerHTML = `<div class="loading">Error cargando datos: ${e.message}</div>`;
  }
}

function renderBadges(d) {
  const fngEl = $('#badge-fng');
  if (d.fearGreed) {
    fngEl.textContent = `Fear & Greed: ${d.fearGreed.value} (${d.fearGreed.label})`;
    fngEl.className = 'badge ' + (d.fearGreed.value <= 30 ? 'red' : d.fearGreed.value >= 70 ? 'green' : 'amber');
  }
  if (d.global?.btcDominance) {
    $('#badge-dominance').textContent = `Dominancia BTC: ${d.global.btcDominance.toFixed(1)}%`;
  }
  const s = d.sentiment;
  const sEl = $('#badge-sentiment');
  sEl.textContent = `Analistas: ${s.label} (${s.score > 0 ? '+' : ''}${s.score})`;
  sEl.className = 'badge ' + (s.score >= 0.5 ? 'green' : s.score <= -0.5 ? 'red' : '');
}

function renderOpportunities(d) {
  const pending = d.errors?.length ? ` · ${d.errors.length} activos cargando…` : '';
  $('#generated-at').textContent = 'Actualizado: ' + new Date(d.generatedAt).toLocaleString('es-ES') + pending;
  const html = d.opportunities.map(o => {
    const cls = o.action === 'comprar' ? 'buy' : o.action.startsWith('vender') ? 'sell' : 'hold';
    const scoreCls = o.score >= 2 ? 'pos' : o.score <= -2 ? 'neg' : 'mid';
    const allSignals = [
      ...o.signals.map(s => `<li class="${s.type}">${s.text}</li>`),
      ...o.fundamentalNotes.map(n => `<li class="fund">${n}</li>`),
      ...o.extraReasons.map(r => `<li class="info">${r}</li>`),
    ];
    const visible = allSignals.slice(0, 4).join('');
    const hidden = allSignals.slice(4).join('');
    return `
    <div class="card ${cls}">
      <div class="card-head">
        <span><span class="sym">${o.symbol}</span> <span class="tag">${TYPE_LABEL[o.type]}</span> <span class="muted">${o.name}</span></span>
        <span class="score ${scoreCls}">${o.score > 0 ? '+' : ''}${o.score}</span>
      </div>
      <div class="price-row">
        <span class="price">${fmtPrice(o.price)}</span>
        ${o.change24h != null ? `<span class="chg ${o.change24h >= 0 ? 'pos' : 'neg'}">${fmtPct(o.change24h)} 24h</span>` : ''}
      </div>
      <div class="action ${cls}">${o.action.toUpperCase()} · tendencia ${o.trend}${o.rsi != null ? ` · RSI ${o.rsi.toFixed(0)}` : ''}</div>
      <div class="trade-grid">
        <span><span class="lbl">Entrada</span>${fmtPrice(o.trade.entry)}</span>
        <span><span class="lbl">Objetivo</span>${fmtPrice(o.trade.target)}</span>
        <span><span class="lbl">Stop</span>${fmtPrice(o.trade.stop)}</span>
        <span><span class="lbl">R/R</span>${o.trade.riskReward ?? '—'}</span>
      </div>
      <ul class="signals">${visible}</ul>
      ${hidden ? `<details class="more"><summary>Más señales…</summary><ul class="signals">${hidden}</ul></details>` : ''}
    </div>`;
  }).join('');
  $('#opportunities').innerHTML = html || '<div class="loading">Sin datos</div>';
}

// ---------- Análisis por activo ----------

let assetsCatalog = null;
let charts = [];

async function loadAssetsCatalog() {
  const res = await fetch('/api/assets');
  assetsCatalog = await res.json();
  const options = [];
  for (const [type, list] of Object.entries(assetsCatalog)) {
    for (const a of list) {
      options.push(`<option value="${type}:${a.id ?? a.symbol}">${a.symbol} — ${a.name} (${TYPE_LABEL[type]})</option>`);
    }
  }
  $('#asset-select').innerHTML = options.join('');
  $('#inv-asset').innerHTML = options.join('');
  $('#asset-select').addEventListener('change', () => loadAnalysis($('#asset-select').value));
  loadAnalysis($('#asset-select').value);
}

async function loadAnalysis(key) {
  const [type, id] = key.split(':');
  $('#analysis-detail').innerHTML = '<div class="loading">Analizando…</div>';
  try {
    const res = await fetch(`/api/analysis/${type}/${id}`);
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    renderAnalysis(d);
  } catch (e) {
    $('#analysis-detail').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

function renderAnalysis(d) {
  const t = d.technical;
  const f = d.fundamental;
  $('#analysis-detail').innerHTML = `
    <div class="charts">
      <div id="chart-price"></div>
      <div class="chart-label">RSI (14)</div>
      <div id="chart-rsi"></div>
      <div class="chart-label">MACD (12, 26, 9)</div>
      <div id="chart-macd"></div>
    </div>
    <div class="analysis-grid">
      <div class="panel">
        <h3>📐 Técnico y chartismo</h3>
        <div class="kv"><span class="k">Precio</span><span>${fmtPrice(t.price)}</span></div>
        <div class="kv"><span class="k">Tendencia</span><span>${t.trend}</span></div>
        <div class="kv"><span class="k">RSI (14)</span><span>${t.rsi?.toFixed(1) ?? '—'}</span></div>
        <div class="kv"><span class="k">MACD hist.</span><span>${t.macd.histogram?.toFixed(4) ?? '—'}</span></div>
        <div class="kv"><span class="k">SMA${t.smaShortPeriod} / SMA${t.smaLongPeriod}</span><span>${fmtPrice(t.smaShort)} / ${fmtPrice(t.smaLong)}</span></div>
        <div class="kv"><span class="k">Soportes</span><span>${t.supports.map(s => fmtPrice(s.price)).join(' · ') || '—'}</span></div>
        <div class="kv"><span class="k">Resistencias</span><span>${t.resistances.map(r => fmtPrice(r.price)).join(' · ') || '—'}</span></div>
        <div class="kv"><span class="k">Patrones</span><span>${t.patterns.join('; ') || 'Ninguno detectado'}</span></div>
        <div class="kv"><span class="k">Score técnico</span><span>${t.technicalScore > 0 ? '+' : ''}${t.technicalScore}</span></div>
        <div class="kv"><span class="k">Entrada / Objetivo / Stop</span><span>${fmtPrice(t.trade.entry)} / ${fmtPrice(t.trade.target)} / ${fmtPrice(t.trade.stop)}</span></div>
      </div>
      <div class="panel">
        <h3>🏛️ Fundamental</h3>
        ${d.type === 'crypto' ? `
          <div class="kv"><span class="k">Capitalización</span><span>${fmtBig(f.data.marketCap)} (#${f.data.rank ?? '—'})</span></div>
          <div class="kv"><span class="k">Volumen 24h</span><span>${fmtBig(f.data.volume24h)}</span></div>
          <div class="kv"><span class="k">Supply circulante</span><span>${f.data.circulatingSupply?.toLocaleString('es-ES', {maximumFractionDigits: 0}) ?? '—'}${f.data.maxSupply ? ' / ' + f.data.maxSupply.toLocaleString('es-ES', {maximumFractionDigits: 0}) : ''}</span></div>
          <div class="kv"><span class="k">Desde máximo histórico</span><span>${fmtPct(f.data.athChangePct)}</span></div>
          <div class="kv"><span class="k">Cambio 7d / 30d</span><span>${fmtPct(f.data.change7d)} / ${fmtPct(f.data.change30d)}</span></div>
        ` : `
          <div class="kv"><span class="k">Máx / Mín 52 semanas</span><span>${fmtPrice(f.data.fiftyTwoWeekHigh)} / ${fmtPrice(f.data.fiftyTwoWeekLow)}</span></div>
          <div class="kv"><span class="k">Mercado</span><span>${f.data.exchange ?? '—'} (${f.data.currency ?? 'USD'})</span></div>
        `}
        <div class="kv"><span class="k">Score fundamental</span><span>${f.score > 0 ? '+' : ''}${f.score}</span></div>
        ${f.notes.length ? `<ul class="signals" style="margin-top:8px">${f.notes.map(n => `<li class="fund">${n}</li>`).join('')}</ul>` : ''}
        <h3 style="margin-top:16px">⚡ Señales</h3>
        <ul class="signals">${t.signals.map(s => `<li class="${s.type}">${s.text}</li>`).join('') || '<li class="info">Sin señales destacadas</li>'}</ul>
      </div>
    </div>`;
  drawCharts(d.series);
}

function drawCharts(series) {
  charts.forEach(c => c.remove());
  charts = [];
  const base = {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
    timeScale: { borderColor: '#2d333b' },
    rightPriceScale: { borderColor: '#2d333b' },
  };

  const priceChart = LightweightCharts.createChart($('#chart-price'), { ...base, height: 340 });
  const candleSeries = priceChart.addCandlestickSeries({
    upColor: '#3fb950', downColor: '#f85149', borderVisible: false,
    wickUpColor: '#3fb950', wickDownColor: '#f85149',
  });
  candleSeries.setData(series.candles);
  const smaS = priceChart.addLineSeries({ color: '#58a6ff', lineWidth: 1, title: `SMA${series.smaShortPeriod}` });
  smaS.setData(series.smaShort);
  const smaL = priceChart.addLineSeries({ color: '#d29922', lineWidth: 1, title: `SMA${series.smaLongPeriod}` });
  smaL.setData(series.smaLong);
  priceChart.timeScale().fitContent();
  charts.push(priceChart);

  const rsiChart = LightweightCharts.createChart($('#chart-rsi'), { ...base, height: 120 });
  const rsiSeries = rsiChart.addLineSeries({ color: '#bc8cff', lineWidth: 1 });
  rsiSeries.setData(series.rsi);
  rsiSeries.createPriceLine({ price: 70, color: '#f85149', lineWidth: 1, lineStyle: 2, title: '70' });
  rsiSeries.createPriceLine({ price: 30, color: '#3fb950', lineWidth: 1, lineStyle: 2, title: '30' });
  rsiChart.timeScale().fitContent();
  charts.push(rsiChart);

  const macdChart = LightweightCharts.createChart($('#chart-macd'), { ...base, height: 120 });
  const histSeries = macdChart.addHistogramSeries({});
  histSeries.setData(series.macdHistogram.map(p => ({ ...p, color: p.value >= 0 ? '#3fb95066' : '#f8514966' })));
  const macdLine = macdChart.addLineSeries({ color: '#58a6ff', lineWidth: 1 });
  macdLine.setData(series.macd);
  const sigLine = macdChart.addLineSeries({ color: '#d29922', lineWidth: 1 });
  sigLine.setData(series.macdSignal);
  macdChart.timeScale().fitContent();
  charts.push(macdChart);
}

// ---------- Analistas ----------

async function loadAnalysts() {
  try {
    const res = await fetch('/api/analysts');
    const list = await res.json();
    $('#analysts').innerHTML = list.map(a => {
      const pillCls = a.sentimentScore >= 0.5 ? 'bull' : a.sentimentScore <= -0.5 ? 'bear' : 'neutral';
      if (a.error) {
        return `<div class="analyst"><div class="analyst-head">
          <a href="${a.url}" target="_blank">${a.name}</a>
          <span class="muted">No disponible: ${a.error}</span></div></div>`;
      }
      return `<div class="analyst">
        <div class="analyst-head">
          <a href="${a.url}" target="_blank">🎥 ${a.name}</a>
          <span class="sentiment-pill ${pillCls}">${a.sentimentLabel} (${a.sentimentScore > 0 ? '+' : ''}${a.sentimentScore})</span>
        </div>
        ${a.videos.slice(0, 5).map(v => `
          <div class="video">
            <a href="${v.url}" target="_blank">${v.title}</a>
            <span class="meta">${v.label !== 'neutral' ? v.label + ' · ' : ''}${new Date(v.published).toLocaleDateString('es-ES')}</span>
          </div>`).join('')}
      </div>`;
    }).join('');
  } catch (e) {
    $('#analysts').innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

// ---------- Cartera ----------

async function loadInvestments() {
  const res = await fetch('/api/investments');
  const list = await res.json();
  const tbody = $('#inv-table tbody');

  let invested = 0, value = 0, hasValue = false;
  tbody.innerHTML = list.map(inv => {
    invested += inv.invested;
    if (inv.currentValue !== null) { value += inv.currentValue; hasValue = true; }
    const pnlCls = inv.pnl == null ? '' : inv.pnl >= 0 ? 'pos' : 'neg';
    return `<tr>
      <td><b>${inv.symbol}</b> <span class="muted">${inv.name}</span>${inv.notes ? `<br><span class="muted">${inv.notes}</span>` : ''}</td>
      <td>${inv.date}</td>
      <td>${inv.quantity}</td>
      <td>${fmtPrice(inv.buyPrice)}</td>
      <td>${fmtPrice(inv.currentPrice)}</td>
      <td>${fmtPrice(inv.invested)}</td>
      <td>${fmtPrice(inv.currentValue)}</td>
      <td class="${pnlCls}">${inv.pnl != null ? fmtPrice(inv.pnl) : '—'}</td>
      <td class="${pnlCls}">${fmtPct(inv.pnlPct)}</td>
      <td><button class="del-btn" data-id="${inv.id}" title="Eliminar">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" class="muted" style="text-align:center">Sin inversiones registradas</td></tr>';

  const pnl = hasValue ? value - invested : null;
  $('#portfolio-summary').innerHTML = `
    <div class="summary-item"><span class="lbl">Invertido</span><span class="val">${fmtPrice(invested)}</span></div>
    <div class="summary-item"><span class="lbl">Valor actual</span><span class="val">${fmtPrice(hasValue ? value : null)}</span></div>
    <div class="summary-item"><span class="lbl">P&L total</span><span class="val" style="color:${pnl == null ? '' : pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pnl != null ? fmtPrice(pnl) : '—'} ${pnl != null && invested > 0 ? '(' + fmtPct((pnl / invested) * 100) + ')' : ''}</span></div>`;

  tbody.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta inversión?')) return;
      await fetch(`/api/investments/${btn.dataset.id}`, { method: 'DELETE' });
      loadInvestments();
    });
  });
}

$('#inv-form').addEventListener('submit', async e => {
  e.preventDefault();
  const [assetType, assetId] = $('#inv-asset').value.split(':');
  const list = assetsCatalog[assetType];
  const asset = list.find(a => (a.id ?? a.symbol) === assetId);
  await fetch('/api/investments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assetType, assetId,
      symbol: asset?.symbol, name: asset?.name,
      quantity: $('#inv-qty').value,
      buyPrice: $('#inv-price').value,
      date: $('#inv-date').value,
      notes: $('#inv-notes').value,
    }),
  });
  e.target.reset();
  loadInvestments();
});

// ---------- Init ----------

loadOverview();
loadAssetsCatalog();
loadAnalysts();
loadInvestments();
