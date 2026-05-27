/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle, PatternResult, MtfResult, IndicatorScores, SignalDetail } from '../types';

export function emaArr(arr: number[], p: number): number[] {
  if (arr.length < p) return [];
  const k = 2 / (p + 1);
  let e = arr.slice(0, p).reduce((sum, val) => sum + val, 0) / p;
  const out = [e];
  for (let i = p; i < arr.length; i++) {
    e = arr[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function ema(arr: number[], p: number): number | null {
  const a = emaArr(arr, p);
  return a.length ? a[a.length - 1] : null;
}

export function rsi(cl: number[], p = 14): number | null {
  if (cl.length < p + 1) return null;
  let g = 0;
  let l = 0;
  for (let i = cl.length - p; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) {
      g += d;
    } else {
      l += Math.abs(d);
    }
  }
  const al = l / p;
  if (!al) return 100;
  return 100 - 100 / (1 + g / p / al);
}

export interface StochResult {
  kA: number[];
  dA: number[];
  k: number;
  d: number;
}

export function stoch(ca: Candle[], kp = 14, dp = 3): StochResult | null {
  if (ca.length < kp) return null;
  const kA: number[] = [];
  for (let i = kp - 1; i < ca.length; i++) {
    const sl = ca.slice(i - kp + 1, i + 1);
    const hh = Math.max(...sl.map((c) => c.h));
    const ll = Math.min(...sl.map((c) => c.l));
    kA.push(hh === ll ? 50 : ((ca[i].c - ll) / (hh - ll)) * 100);
  }
  const dA: number[] = [];
  for (let i = dp - 1; i < kA.length; i++) {
    const avg = kA.slice(i - dp + 1, i + 1).reduce((sum, val) => sum + val, 0) / dp;
    dA.push(avg);
  }
  return {
    kA,
    dA,
    k: kA[kA.length - 1],
    d: dA[dA.length - 1],
  };
}

export interface MacdResult {
  ml: number[];
  sg: number[];
  hA: number[];
  macd: number;
  sig: number;
  hist: number;
  histP: number;
}

export function macdData(cl: number[]): MacdResult | null {
  if (cl.length < 35) return null;
  const e12 = emaArr(cl, 12);
  const e26 = emaArr(cl, 26);
  const mn = Math.min(e12.length, e26.length);
  const ml: number[] = [];
  for (let i = 0; i < mn; i++) {
    ml.push(e12[e12.length - mn + i] - e26[e26.length - mn + i]);
  }
  if (ml.length < 9) return null;
  const sg = emaArr(ml, 9);
  const hA: number[] = [];
  for (let i = 0; i < sg.length; i++) {
    hA.push(ml[ml.length - sg.length + i] - sg[i]);
  }
  return {
    ml: ml.slice(-sg.length),
    sg,
    hA,
    macd: ml[ml.length - 1],
    sig: sg[sg.length - 1],
    hist: hA[hA.length - 1],
    histP: hA[hA.length - 2],
  };
}

export function atr(ca: Candle[], p = 14): number | null {
  if (ca.length < p + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < ca.length; i++) {
    const h = ca[i].h;
    const l = ca[i].l;
    const pc = ca[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.slice(-p).reduce((sum, val) => sum + val, 0) / p;
}

export function vwap(ca: Candle[]): number | null {
  let sp = 0;
  let sv = 0;
  for (const c of ca) {
    const tp = (c.h + c.l + c.c) / 3;
    sp += tp * c.v;
    sv += c.v;
  }
  return sv ? sp / sv : null;
}

export interface BbResult {
  u: number;
  m: number;
  l: number;
}

export function bb(cl: number[], p = 20): BbResult | null {
  if (cl.length < p) return null;
  const sl = cl.slice(-p);
  const m = sl.reduce((sum, val) => sum + val, 0) / p;
  const variance = sl.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / p;
  const s = Math.sqrt(variance);
  return {
    u: m + 2 * s,
    m,
    l: m - 2 * s,
  };
}

export function pattern(ca: Candle[]): PatternResult | null {
  if (ca.length < 2) return null;
  const cu = ca[ca.length - 1];
  const pr = ca[ca.length - 2];
  const cb = Math.abs(cu.c - cu.o);
  const cr = cu.h - cu.l;
  if (!cr) return null;
  const ub = cu.h - Math.max(cu.c, cu.o);
  const lb = Math.min(cu.c, cu.o) - cu.l;
  const bull = cu.c >= cu.o;
  const pbull = pr.c >= pr.o;

  if (cb / cr < 0.08) {
    return { n: 'Doji', s: 0, d: 'indecisão — sem direção clara das forças compradoras/vendedoras' };
  }
  if (lb > 2 * cb && ub < cb * 0.5) {
    return { n: 'Martelo', s: 2, d: 'rejeição de mínimos — forte pressão compradora e possível reversão de alta' };
  }
  if (ub > 2 * cb && lb < cb * 0.5) {
    return { n: 'Estrela cadente', s: -2, d: 'rejeição de máximos — forte pressão vendedora e possível reversão de baixa' };
  }
  if (bull && !pbull && cu.o <= pr.c && cu.c >= pr.o) {
    return { n: 'Engolfo de alta', s: 3, d: 'vela engole a anterior — forte reversão para viés de compra' };
  }
  if (!bull && pbull && cu.o >= pr.c && cu.c <= pr.o) {
    return { n: 'Engolfo de baixa', s: -3, d: 'vela engole a anterior — forte reversão para viés de venda' };
  }
  return null;
}

export function mtfAssess(ca5: Candle[]): MtfResult | null {
  if (!ca5 || ca5.length < 20) return null;
  const cl = ca5.map((c) => c.c);
  const last = ca5[ca5.length - 1];
  const e9 = ema(cl, 9);
  const e20 = ema(cl, 20);
  const m = cl.length >= 35 ? macdData(cl) : null;
  let sc = 0;
  if (e9 && e20) {
    if (last.c > e9) sc++;
    if (last.c > e20) sc++;
    if (e9 > e20) sc++;
  }
  if (m) {
    if (m.macd > 0) sc++;
    if (m.hist > 0) sc++;
  }
  return {
    sc,
    bull: sc >= 2, // If at least 2 conditions met, trend leans bullish
  };
}

export function formatNumber(n: number, d = 2): string {
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function score(ca1: Candle[], caMacro: Candle[], macroTf: number = 5): IndicatorScores {
  const cl = ca1.map((c) => c.c);
  const last = ca1[ca1.length - 1];
  const sigs: SignalDetail[] = [];
  let tot = 0;

  const addS = (lbl: string, sc: number, badge: 'bul' | 'ber' | 'neu') => {
    tot += sc;
    sigs.push({ lbl, sc, badge });
  };

  // 1. RSI Scoring
  const r = rsi(cl);
  if (r !== null) {
    if (r < 30) {
      addS(`RSI (${formatNumber(r, 1)}) — Fortemente Sobrevendido`, 3, 'bul');
    } else if (r < 40) {
      addS(`RSI (${formatNumber(r, 1)}) — Zona fraca de sobrevenda, acumulação`, 2, 'bul');
    } else if (r < 52) {
      addS(`RSI (${formatNumber(r, 1)}) — Neutro com viés leve de alta`, 1, 'bul');
    } else if (r < 65) {
      addS(`RSI (${formatNumber(r, 1)}) — Neutro com viés leve de baixa`, -1, 'ber');
    } else if (r < 75) {
      addS(`RSI (${formatNumber(r, 1)}) — Sobrecomprado`, -2, 'ber');
    } else {
      addS(`RSI (${formatNumber(r, 1)}) — Fortemente Sobrecomprado`, -3, 'ber');
    }
  }

  // 2. Stochastic Scoring
  const st = stoch(ca1);
  if (st && st.k !== undefined) {
    const xbull = st.k > st.d;
    if (st.k < 20 && xbull) {
      addS(`Estocástico: Sobrevendido + Cruzamento de Alta (%K ${formatNumber(st.k, 1)})`, 3, 'bul');
    } else if (st.k < 30) {
      addS(`Estocástico: Zona de sobrevenda (%K ${formatNumber(st.k, 1)})`, 2, 'bul');
    } else if (st.k > 80 && !xbull) {
      addS(`Estocástico: Sobrecomprado + Cruzamento de Baixa (%K ${formatNumber(st.k, 1)})`, -3, 'ber');
    } else if (st.k > 70) {
      addS(`Estocástico: Zona de sobrecompra (%K ${formatNumber(st.k, 1)})`, -2, 'ber');
    } else if (xbull) {
      addS(`Estocástico: %K acima de %D (${formatNumber(st.k, 1)} vs ${formatNumber(st.d, 1)})`, 1, 'bul');
    } else {
      addS(`Estocástico: %K abaixo de %D (${formatNumber(st.k, 1)} vs ${formatNumber(st.d, 1)})`, -1, 'ber');
    }
  }

  // 3. MACD Scoring
  const md = macdData(cl);
  if (md) {
    if (md.macd > 0 && md.hist > md.histP) {
      addS(`MACD positivo e histograma crescendo (+${formatNumber(md.hist, 2)})`, 3, 'bul');
    } else if (md.macd > 0) {
      addS(`MACD positivo (${formatNumber(md.macd, 2)})`, 1, 'bul');
    } else if (md.macd < 0 && md.hist < md.histP) {
      addS(`MACD negativo e histograma caindo (${formatNumber(md.hist, 2)})`, -3, 'ber');
    } else {
      addS(`MACD negativo (${formatNumber(md.macd, 2)})`, -1, 'ber');
    }
  }

  // 4. Bollinger Bands Scoring
  const bnd = bb(cl);
  if (bnd) {
    const pct = (last.c - bnd.l) / (bnd.u - bnd.l);
    if (last.c < bnd.l) {
      addS('Bollinger: Preço abaixo da banda inferior — Suporte Testado', 2, 'bul');
    } else if (pct < 0.3) {
      addS(`Bollinger: Próximo à banda inferior (${(pct * 100).toFixed(0)}%)`, 1, 'bul');
    } else if (last.c > bnd.u) {
      addS('Bollinger: Preço acima da banda superior — Resistência Testada', -2, 'ber');
    } else if (pct > 0.7) {
      addS(`Bollinger: Próximo à banda superior (${(pct * 100).toFixed(0)}%)`, -1, 'ber');
    } else {
      sigs.push({ lbl: `Bollinger: Preço equilibrado no meio do canal (${(pct * 100).toFixed(0)}%)`, sc: 0, badge: 'neu' });
    }
  }

  // 5. VWAP Scoring
  const vw = vwap(ca1);
  if (vw) {
    if (last.c > vw * 1.001) {
      addS(`Preço robusto acima do VWAP ($${formatNumber(vw)})`, 1, 'bul');
    } else if (last.c < vw * 0.999) {
      addS(`Preço enfraquecido abaixo do VWAP ($${formatNumber(vw)})`, -1, 'ber');
    } else {
      sigs.push({ lbl: `Preço oscilando sobre o VWAP ($${formatNumber(vw)})`, sc: 0, badge: 'neu' });
    }
  }

  // 6. EMA Trend Scoring
  const e9 = ema(cl, 9);
  const e20v = ema(cl, 20);
  if (e9 && e20v) {
    if (e9 > e20v && last.c > e9) {
      addS('EMA 9 > EMA 20, preço acima de ambas — Forte tendência de alta', 2, 'bul');
    } else if (e9 < e20v && last.c < e9) {
      addS('EMA 9 < EMA 20, preço abaixo de ambas — Forte tendência de baixa', -2, 'ber');
    } else if (last.c > e9) {
      addS(`Preço recuperando acima da EMA 9 ($${formatNumber(e9)})`, 1, 'bul');
    } else {
      addS(`Preço enfraquecendo abaixo da EMA 9 ($${formatNumber(e9)})`, -1, 'ber');
    }
  }

  // 7. Candlestick Pattern Scoring
  const pat = pattern(ca1);
  if (pat) {
    tot += pat.s;
    sigs.push({
      lbl: `Padrão de Vela: ${pat.n} — ${pat.d}`,
      sc: pat.s,
      badge: pat.s > 0 ? 'bul' : pat.s < 0 ? 'ber' : 'neu',
    });
  }

  // 8. Multi-timeframe confirmation (M2 or M5)
  const mt = mtfAssess(caMacro);
  if (mt) {
    const s = mt.bull ? 3 : -3;
    addS(`Alinhamento M${macroTf}: Tendência de ${mt.bull ? 'Alta' : 'Baixa'} (Score ${mt.sc})`, s, mt.bull ? 'bul' : 'ber');
  }

  // 9. Volume Confirmation
  const vols = ca1.map((c) => c.v);
  const avgV = vols.slice(-10).reduce((sum, val) => sum + val, 0) / 10;
  const lv = vols[vols.length - 1];
  const lbull = last.c >= last.o;
  if (lv > avgV * 1.25 && avgV > 0) {
    const s = lbull ? 1 : -1;
    addS(`Volume Alto: ${formatNumber(lv, 1)} (${((lv / avgV - 1) * 100).toFixed(0)}% acima da média) confirma força da ${lbull ? 'Alta' : 'Baixa'}`, s, lbull ? 'bul' : 'ber');
  }

  const maxP = 21;
  const pct2 = Math.min(Math.abs(tot) / maxP, 1);
  let conf: IndicatorScores['conf'] = 'moderado';
  if (pct2 < 0.15) conf = 'muito fraco';
  else if (pct2 < 0.3) conf = 'fraco';
  else if (pct2 < 0.5) conf = 'moderado';
  else if (pct2 < 0.7) conf = 'razoável';
  else conf = 'forte';

  const bulletsCount = Math.round(pct2 * 5);
  const dots = '●'.repeat(bulletsCount) + '○'.repeat(Math.max(0, 5 - bulletsCount));

  return {
    tot,
    sigs,
    conf,
    dots,
    pat,
    mt,
  };
}

export interface OperabilityInfo {
  state: 'BAIXA' | 'SAUDAVEL' | 'EXTREMA' | 'SEM_DADOS';
  label: string;
  relativeVol: number;
  suitability: 'EVITAR' | 'EXCELENTE' | 'ALTO_RISCO';
  suitabilityLabel: string;
  explanation: string;
  colorClass: string;
}

export function getOperabilityInfo(atrValue: number | null, close: number | null): OperabilityInfo {
  if (!atrValue || !close || close === 0) {
    return {
      state: 'SEM_DADOS',
      label: 'Calculando...',
      relativeVol: 0,
      suitability: 'EVITAR',
      suitabilityLabel: 'Aguardando...',
      explanation: 'Sincronizando dados históricos dos candles.',
      colorClass: 'text-zinc-500 bg-zinc-950 border-zinc-900'
    };
  }

  const relativeVol = (atrValue / close) * 100;

  if (relativeVol < 0.045) {
    return {
      state: 'BAIXA',
      label: 'Lateralizado',
      relativeVol,
      suitability: 'EVITAR',
      suitabilityLabel: 'Evitar Operar ⚠️',
      explanation: 'Volatilidade muito baixa. Perigo de ruído e mercado travado.',
      colorClass: 'bg-zinc-950/50 text-zinc-400 border-zinc-900'
    };
  } else if (relativeVol > 0.18) {
    return {
      state: 'EXTREMA',
      label: 'Extrema / Ruído',
      relativeVol,
      suitability: 'ALTO_RISCO',
      suitabilityLabel: 'Atenção / Risco 🔥',
      explanation: 'Oscilações excessivas por fluxo. Tendências instáveis.',
      colorClass: 'bg-amber-950/20 text-amber-400 border-amber-500/20'
    };
  } else {
    return {
      state: 'SAUDAVEL',
      label: 'Saudável / Ideal',
      relativeVol,
      suitability: 'EXCELENTE',
      suitabilityLabel: 'Bom Momento ⚡',
      explanation: 'Velas com bom corpo. Movimentos ideais para análise técnica.',
      colorClass: 'bg-emerald-950/20 text-emerald-400 border-emerald-500/20'
    };
  }
}

