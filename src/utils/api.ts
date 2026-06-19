/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../types';

/**
 * Mapeia os símbolos selecionados para símbolos de API locais e públicos
 */
export const ASSET_MAP = {
  // Principais / Majors
  'BTC/USD': { codersSym: 'btcusd', binanceSym: 'BTCUSDT', name: 'Bitcoin', category: 'Principais' },
  'ETH/USD': { codersSym: 'ethusd', binanceSym: 'ETHUSDT', name: 'Ethereum', category: 'Principais' },
  'SOL/USD': { codersSym: 'solusd', binanceSym: 'SOLUSDT', name: 'Solana', category: 'Principais' },
  'BNB/USD': { codersSym: 'bnbusd', binanceSym: 'BNBUSDT', name: 'Binance Coin', category: 'Principais' },
  'XRP/USD': { codersSym: 'xrpusd', binanceSym: 'XRPUSDT', name: 'Ripple', category: 'Principais' },

  // Layer 1s / Smart Contracts
  'ADA/USD': { codersSym: 'adausd', binanceSym: 'ADAUSDT', name: 'Cardano', category: 'Layer 1s' },
  'AVAX/USD': { codersSym: 'avaxusd', binanceSym: 'AVAXUSDT', name: 'Avalanche', category: 'Layer 1s' },
  'DOT/USD': { codersSym: 'dotusd', binanceSym: 'DOTUSDT', name: 'Polkadot', category: 'Layer 1s' },
  'NEAR/USD': { codersSym: 'nearusd', binanceSym: 'NEARUSDT', name: 'Near Protocol', category: 'Layer 1s' },
  'SUI/USD': { codersSym: 'suiusd', binanceSym: 'SUIUSDT', name: 'Sui Network', category: 'Layer 1s' },

  // DeFi & Oráculos
  'LINK/USD': { codersSym: 'linkusd', binanceSym: 'LINKUSDT', name: 'Chainlink', category: 'DeFi & Oráculos' },

  // Memecoins
  'DOGE/USD': { codersSym: 'dogeusd', binanceSym: 'DOGEUSDT', name: 'Dogecoin', category: 'Memecoins' },
  'SHIB/USD': { codersSym: 'shibusd', binanceSym: 'SHIBUSDT', name: 'Shiba Inu', category: 'Memecoins' },
  'PEPE/USD': { codersSym: 'pepeusd', binanceSym: 'PEPEUSDT', name: 'Pepe', category: 'Memecoins' },
  'WIF/USD': { codersSym: 'wifusd', binanceSym: 'WIFUSDT', name: 'dogwifhat', category: 'Memecoins' },
};

/**
 * Fetches candlestick data from the user specified endpoint or fails over to Binance.
 * @param resolution Minute interval (1 = M1, 5 = M5, 15 = M15)
 * @param countback Number of candles to return
 * @param symbol Symbol key (e.g., 'BTC/USD', 'ETH/USD')
 */
export async function fetchCandles(
  resolution: number,
  countback: number,
  symbol: keyof typeof ASSET_MAP = 'BTC/USD',
  apiSelection: 'coders' | 'binance' = 'binance'
): Promise<Candle[]> {
  const asset = ASSET_MAP[symbol] || ASSET_MAP['BTC/USD'];
  return fetchFromBinance(resolution, countback, asset.binanceSym);
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
    throw new Error(`Binance Spot API responded with status ${response.status}`);
  }
  
  const rawData = await response.json();
  if (!Array.isArray(rawData)) {
    throw new Error('Binance returned non-array payload');
  }

  // Binance kline elements:
  // [
  //   [
  //     1499040000000,      // Kline open time (ms)
  //     "0.01634790",       // Open price
  //     "0.80000000",       // High price
  //     "0.01575800",       // Low price
  //     "0.01577100",       // Close price
  //     "148.93450000",     // Volume
  //     1499644799999,      // Kline Close time (ms)
  //     ...
  //   ]
  // ]
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
