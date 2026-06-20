/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../types';

/**
 * Mapeia os símbolos selecionados para símbolos de API locais e públicos (Binance)
 */
export const ASSET_MAP = {
  // Principais / Majors
  'BTC/USD': { symbol: 'BTC/USD', binanceSym: 'BTCUSDT', name: 'Bitcoin', category: 'Principais' },
  'ETH/USD': { symbol: 'ETH/USD', binanceSym: 'ETHUSDT', name: 'Ethereum', category: 'Principais' },
  'SOL/USD': { symbol: 'SOL/USD', binanceSym: 'SOLUSDT', name: 'Solana', category: 'Principais' },
  'BNB/USD': { symbol: 'BNB/USD', binanceSym: 'BNBUSDT', name: 'Binance Coin', category: 'Principais' },
  'XRP/USD': { symbol: 'XRP/USD', binanceSym: 'XRPUSDT', name: 'Ripple', category: 'Principais' },

  // Layer 1s / Smart Contracts
  'ADA/USD': { symbol: 'ADA/USD', binanceSym: 'ADAUSDT', name: 'Cardano', category: 'Layer 1s' },
  'AVAX/USD': { symbol: 'AVAX/USD', binanceSym: 'AVAXUSDT', name: 'Avalanche', category: 'Layer 1s' },
  'DOT/USD': { symbol: 'DOT/USD', binanceSym: 'DOTUSDT', name: 'Polkadot', category: 'Layer 1s' },
  'NEAR/USD': { symbol: 'NEAR/USD', binanceSym: 'NEARUSDT', name: 'Near Protocol', category: 'Layer 1s' },
  'SUI/USD': { symbol: 'SUI/USD', binanceSym: 'SUIUSDT', name: 'Sui Network', category: 'Layer 1s' },

  // DeFi & Oráculos
  'LINK/USD': { symbol: 'LINK/USD', binanceSym: 'LINKUSDT', name: 'Chainlink', category: 'DeFi & Oráculos' },

  // Memecoins
  'DOGE/USD': { symbol: 'DOGE/USD', binanceSym: 'DOGEUSDT', name: 'Dogecoin', category: 'Memecoins' },
  'SHIB/USD': { symbol: 'SHIB/USD', binanceSym: 'SHIBUSDT', name: 'Shiba Inu', category: 'Memecoins' },
  'PEPE/USD': { symbol: 'PEPE/USD', binanceSym: 'PEPEUSDT', name: 'Pepe', category: 'Memecoins' },
  'WIF/USD': { symbol: 'WIF/USD', binanceSym: 'WIFUSDT', name: 'dogwifhat', category: 'Memecoins' },
};

/**
 * Ativos padrão do HomeBroker caso a consulta à API demore ou para fallback rápido
 */
export const DEFAULT_HOMEBROKER_ASSETS: Record<string, { symbol: string; name: string; category: string }> = {
  'BTC-USD-OTC': { symbol: 'BTC-USD-OTC', name: 'Bitcoin (OTC)', category: 'Criptoativos' },
  'GOOG-OTC': { symbol: 'GOOG-OTC', name: 'Google (OTC)', category: 'Mercado de Ações (OTC)' },
  'NVDA': { symbol: 'NVDA', name: 'NVIDIA Stock', category: 'Mercado de Ações (OTC)' },
  'EUR-USD-OTC': { symbol: 'EUR-USD-OTC', name: 'Euro / US Dollar (OTC)', category: 'Câmbio / Forex' },
  'GBP-USD-OTC': { symbol: 'GBP-USD-OTC', name: 'British Pound / US Dollar (OTC)', category: 'Câmbio / Forex' },
};

/**
 * Fetches candlestick data from the user specified broker (Binance or HomeBroker server proxy).
 */
export async function fetchCandles(
  resolution: number,
  countback: number,
  symbol: string,
  broker: 'binance' | 'homebroker'
): Promise<Candle[]> {
  if (broker === 'homebroker') {
    return fetchFromHomeBroker(resolution, countback, symbol);
  }
  
  // Find binance mapping or fallback to symbol itself
  const asset = (ASSET_MAP as any)[symbol];
  const binanceSym = asset ? asset.binanceSym : symbol.replace('/', '').replace('-', '');
  
  return fetchFromBinance(resolution, countback, binanceSym);
}

/**
 * Fetch candles via HomeBroker server proxy to avoid browser-side CORS blocks
 */
async function fetchFromHomeBroker(resolution: number, countback: number, symbol: string): Promise<Candle[]> {
  const url = `/api/homebroker/candles?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&countback=${countback}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`O proxy do HomeBroker retornou status de erro ${response.status}`);
  }
  const data = await response.json();
  if (data && data.error) {
    throw new Error(data.error);
  }
  return data;
}

/**
 * Direct public Binance API klines fetcher
 */
async function fetchFromBinance(resolution: number, countback: number, symbol: string): Promise<Candle[]> {
  const isM2 = resolution === 2;
  const binanceResolution = isM2 ? 1 : resolution;
  let interval = `${binanceResolution}m`;
  if (resolution === 60) {
    interval = '1h';
  } else if (resolution === 15) {
    interval = '15m';
  }
  const limit = isM2 ? countback * 2 + 10 : countback;
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance Spot API respondeu com status ${response.status}`);
  }
  
  const rawData = await response.json();
  if (!Array.isArray(rawData)) {
    throw new Error('Retorno da Binance não veio em formato de array');
  }

  const candles: Candle[] = rawData.map((item: any) => ({
    t: Math.floor(Number(item[0]) / 1000),
    o: parseFloat(item[1]),
    h: parseFloat(item[2]),
    l: parseFloat(item[3]),
    c: parseFloat(item[4]),
    v: parseFloat(item[5]),
  }));

  // Ensure strict chronological ordering
  candles.sort((a, b) => a.t - b.t);

  if (!isM2) {
    return candles;
  }

  // Aggregate M1 candles into synthetic M2 candles to solve Binance's missing 2m interval
  const aggregated: Candle[] = [];
  const groups: { [key: number]: Candle[] } = {};

  for (const c of candles) {
    // Round down to even minute block (120 seconds interval)
    const bucket = Math.floor(c.t / 120) * 120;
    if (!groups[bucket]) {
      groups[bucket] = [];
    }
    groups[bucket].push(c);
  }

  const buckets = Object.keys(groups).map(Number).sort((a, b) => a - b);
  for (const bucket of buckets) {
    const list = groups[bucket];
    list.sort((a, b) => a.t - b.t);
    
    const o = list[0].o;
    const c = list[list.length - 1].c;
    const h = Math.max(...list.map(x => x.h));
    const l = Math.min(...list.map(x => x.l));
    const v = list.reduce((sum, x) => sum + x.v, 0);

    aggregated.push({
      t: bucket,
      o,
      h,
      l,
      c,
      v,
    });
  }

  return aggregated.slice(-countback);
}
