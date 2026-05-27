/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../types';

/**
 * Mapeia os símbolos selecionados para símbolos de API locais e públicos
 */
export const ASSET_MAP = {
  'BTC/USD': { codersSym: 'btcusd', binanceSym: 'BTCUSDT', name: 'Bitcoin / Dólar' },
  'ETH/USD': { codersSym: 'ethusd', binanceSym: 'ETHUSDT', name: 'Ethereum / Dólar' },
  'SOL/USD': { codersSym: 'solusd', binanceSym: 'SOLUSDT', name: 'Solana / Dólar' },
  'BNB/USD': { codersSym: 'bnbusd', binanceSym: 'BNBUSDT', name: 'BNB / Dólar' },
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
  apiSelection: 'coders' | 'binance' = 'coders'
): Promise<Candle[]> {
  const asset = ASSET_MAP[symbol] || ASSET_MAP['BTC/USD'];
  const nowUnix = Math.floor(Date.now() / 1000);
  // Subtract generous window buffer based on resolution minutes
  const fromUnix = nowUnix - resolution * countback * 90;

  if (apiSelection === 'binance') {
    return fetchFromBinance(resolution, countback, asset.binanceSym);
  }

  try {
    // Attempt the primary API first
    const primaryUrl = `https://api5.coders-master.com/history?symbol=${asset.codersSym}&resolution=${resolution}&from=${fromUnix}&to=${nowUnix}&countback=${countback}`;
    const response = await fetch(primaryUrl);
    if (!response.ok) {
      throw new Error(`Primary API responded with status ${response.status}`);
    }
    const data = await response.json();
    if (data && data.s === 'ok' && Array.isArray(data.t) && data.t.length > 0) {
      const candles: Candle[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < data.t.length; i++) {
        const time = data.t[i];
        if (seen.has(time)) continue;
        seen.add(time);
        candles.push({
          t: time,
          o: Number(data.o[i]),
          h: Number(data.h[i]),
          l: Number(data.l[i]),
          c: Number(data.c[i]),
          v: Number(data.v[i]),
        });
      }
      // Sort in ascending order by timestamp
      candles.sort((a, b) => a.t - b.t);
      if (candles.length > 0) return candles;
    }
    throw new Error('Primary API returned empty or invalid data format');
  } catch (primaryErr) {
    console.warn('Fallback to Binance Spot API due to primary fetch error:', primaryErr);
    return fetchFromBinance(resolution, countback, asset.binanceSym);
  }
}

/**
 * Direct public Binance API klines fetcher
 */
async function fetchFromBinance(resolution: number, countback: number, symbol: string): Promise<Candle[]> {
  const isM2 = resolution === 2;
  const binanceResolution = isM2 ? 1 : resolution;
  const interval = `${binanceResolution}m`;
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
