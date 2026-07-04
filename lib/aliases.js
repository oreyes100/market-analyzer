// Alias de los 19 activos para detectar menciones en texto libre (transcripciones, títulos de Reddit)
// y mapeo a símbolos de StockTwits.

export const ASSET_ALIASES = {
  // crypto — id de CoinGecko
  bitcoin:     { type: 'crypto', symbol: 'BTC',  st: 'BTC.X',  words: ['bitcoin', 'btc'] },
  ethereum:    { type: 'crypto', symbol: 'ETH',  st: 'ETH.X',  words: ['ethereum', 'eth', 'ether'] },
  solana:      { type: 'crypto', symbol: 'SOL',  st: 'SOL.X',  words: ['solana', 'sol'] },
  binancecoin: { type: 'crypto', symbol: 'BNB',  st: 'BNB.X',  words: ['bnb', 'binance coin'] },
  ripple:      { type: 'crypto', symbol: 'XRP',  st: 'XRP.X',  words: ['xrp', 'ripple'] },
  cardano:     { type: 'crypto', symbol: 'ADA',  st: 'ADA.X',  words: ['cardano', 'ada'] },
  // acciones
  AAPL:  { type: 'stock', symbol: 'AAPL',  st: 'AAPL',  words: ['apple', 'aapl'] },
  MSFT:  { type: 'stock', symbol: 'MSFT',  st: 'MSFT',  words: ['microsoft', 'msft'] },
  NVDA:  { type: 'stock', symbol: 'NVDA',  st: 'NVDA',  words: ['nvidia', 'nvda'] },
  GOOGL: { type: 'stock', symbol: 'GOOGL', st: 'GOOGL', words: ['google', 'alphabet', 'googl'] },
  AMZN:  { type: 'stock', symbol: 'AMZN',  st: 'AMZN',  words: ['amazon', 'amzn'] },
  META:  { type: 'stock', symbol: 'META',  st: 'META',  words: ['meta', 'facebook'] },
  TSLA:  { type: 'stock', symbol: 'TSLA',  st: 'TSLA',  words: ['tesla', 'tsla'] },
  // ETFs
  SPY:  { type: 'etf', symbol: 'SPY',  st: 'SPY',  words: ['spy', 's&p 500', 'sp500', 's&p'] },
  QQQ:  { type: 'etf', symbol: 'QQQ',  st: 'QQQ',  words: ['qqq', 'nasdaq 100', 'nasdaq'] },
  VTI:  { type: 'etf', symbol: 'VTI',  st: 'VTI',  words: ['vti'] },
  GLD:  { type: 'etf', symbol: 'GLD',  st: 'GLD',  words: ['gld', 'gold', 'oro'] },
  IBIT: { type: 'etf', symbol: 'IBIT', st: 'IBIT', words: ['ibit', 'ishares bitcoin'] },
  TLT:  { type: 'etf', symbol: 'TLT',  st: 'TLT',  words: ['tlt', 'treasury bonds', 'bonos del tesoro'] },
};

// Palabras de un solo uso muy ambiguas ('sol', 'meta', 'ada', 'oro') exigen contexto financiero cerca
const AMBIGUOUS = new Set(['sol', 'meta', 'ada', 'oro', 'gold', 'nasdaq', 's&p']);
const FINANCE_CONTEXT = /precio|price|compra|venta|buy|sell|market|mercado|invert|trading|chart|gráfico|resistencia|soporte|support|resistance|rally|crash|token|coin|stock|acción|dólar|dollar|\$/i;

// Detecta activos mencionados en un texto. Devuelve array de assetIds.
export function detectAssets(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const found = [];
  for (const [id, a] of Object.entries(ASSET_ALIASES)) {
    for (const w of a.words) {
      const re = new RegExp(`[^a-záéíóúñ0-9&]${escapeRe(w)}[^a-záéíóúñ0-9]`, 'i');
      if (re.test(t)) {
        if (AMBIGUOUS.has(w) && !FINANCE_CONTEXT.test(text)) continue;
        found.push(id);
        break;
      }
    }
  }
  return found;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Para el parser de voz: encontrar activo por nombre hablado ("bitcoin", "apple", "nasdaq"...)
export function assetFromSpeech(text) {
  const ids = detectAssets(' ' + text + ' precio '); // inyecta contexto financiero para desambiguar
  return ids[0] ?? null;
}
