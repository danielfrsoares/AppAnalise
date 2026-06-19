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

export function score(ca1: Candle[], caM2: Candle[], caM5: Candle[]): IndicatorScores {
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

  // 8. Multi-timeframe confirmation (M2 & M5)
  const mtM2 = mtfAssess(caM2);
  const mtM5 = mtfAssess(caM5);
  let mtBias: 'Alta' | 'Baixa' | 'Neutro' = 'Neutro';
  let mtScore = 0;
  let mtText = 'Divergência Multi-timeframe: Sem alinhamento macro unificado M2 & M5';

  if (mtM2 && mtM5) {
    if (mtM2.bull && mtM5.bull) {
      mtBias = 'Alta';
      mtScore = 3;
      mtText = 'Alinhamento Macro M2 & M5: Ambos confirmam tendência de Alta';
    } else if (!mtM2.bull && !mtM5.bull) {
      mtBias = 'Baixa';
      mtScore = -3;
      mtText = 'Alinhamento Macro M2 & M5: Ambos confirmam tendência de Baixa';
    } else {
      mtBias = 'Neutro';
      mtScore = 0;
      mtText = `Divergência Macro: M2 está ${mtM2.bull ? 'Alta' : 'Baixa'} e M5 está ${mtM5.bull ? 'Alta' : 'Baixa'}`;
    }
    
    if (mtScore !== 0) {
      addS(mtText, mtScore, mtBias === 'Alta' ? 'bul' : 'ber');
    } else {
      sigs.push({ lbl: mtText, sc: 0, badge: 'neu' });
    }
  }

  const mt = mtM2 && mtM5 && mtBias !== 'Neutro' ? {
    sc: Math.round((mtM2.sc + mtM5.sc) / 2),
    bull: mtBias === 'Alta'
  } : null;

  // 9. Volume Confirmation & Dynamics
  const vols = ca1.map((c) => c.v);
  const avgV = vols.slice(-10).reduce((sum, val) => sum + val, 0) / 10;
  const lv = vols[vols.length - 1];
  const lbull = last.c >= last.o;
  if (lv > avgV * 1.25 && avgV > 0) {
    const s = lbull ? 1 : -1;
    addS(`Volume Alto: ${formatNumber(lv, 1)} (${((lv / avgV - 1) * 100).toFixed(0)}% acima da média) confirma força da ${lbull ? 'Alta' : 'Baixa'}`, s, lbull ? 'bul' : 'ber');
  }

  // ============== FASE 2: MOTOR DE DECISÃO & CONFLUÊNCIA SMC/FLOW ==============
  // 9. SMC Market Structure Evaluation
  const ms = detectMarketStructure(ca1);
  let msBias: 'Alta' | 'Baixa' | 'Neutro' = 'Neutro';
  let msScoreValue = 0;
  if (ms.chochDetected) {
    msBias = ms.chochType === 'BULLISH' ? 'Alta' : 'Baixa';
    msScoreValue = ms.chochType === 'BULLISH' ? 2 : -2;
    addS(`CHoCH SMC Detectado: Ruptura de reversão para ${msBias === 'Alta' ? 'Alta' : 'Baixa'} em $${formatNumber(ms.chochPrice || 0)}`, msScoreValue, msBias === 'Alta' ? 'bul' : 'ber');
  } else if (ms.bosDetected) {
    msBias = ms.bosType === 'BULLISH' ? 'Alta' : 'Baixa';
    msScoreValue = ms.bosType === 'BULLISH' ? 2 : -2;
    addS(`BOS SMC Detectado: Continuação estrutural para ${msBias === 'Alta' ? 'Alta' : 'Baixa'} em $${formatNumber(ms.bosPrice || 0)}`, msScoreValue, msBias === 'Alta' ? 'bul' : 'ber');
  }

  // 10. Order Flow Cumulative Volume Delta (CVD)
  const cvd = calculateCVD(ca1);
  let cvdBias: 'Alta' | 'Baixa' | 'Neutro' = 'Neutro';
  let cvdScoreValue = 0;
  if (cvd) {
    if (cvd.imbalance === 'BUY_PRESSURE') {
      cvdBias = 'Alta';
      cvdScoreValue = 2;
    } else if (cvd.imbalance === 'SELL_PRESSURE') {
      cvdBias = 'Baixa';
      cvdScoreValue = -2;
    } else if (cvd.lastDelta > 0) {
      cvdBias = 'Alta';
      cvdScoreValue = 1;
    } else if (cvd.lastDelta < 0) {
      cvdBias = 'Baixa';
      cvdScoreValue = -1;
    }
    if (cvdScoreValue !== 0) {
      addS(`CVD (Order Flow): Divergência de agressão ${cvdBias === 'Alta' ? 'compradora ▲' : 'vendedora ▼'} (Razão: ${formatNumber(cvd.imbalanceRatio, 1)}x)`, cvdScoreValue, cvdBias === 'Alta' ? 'bul' : 'ber');
    }
  }

  // Determine Overall Direction of the indicators scoring
  const overallBull = tot >= 0;

  // Build the 10-Factor Confluence Table
  const factors: { name: string; score: number; bias: 'Alta' | 'Baixa' | 'Neutro'; aligned: boolean }[] = [];

  // Helper to add factor
  const pushFactor = (name: string, fb: 'Alta' | 'Baixa' | 'Neutro', fsc: number) => {
    factors.push({
      name,
      score: fsc,
      bias: fb,
      aligned: fb === (overallBull ? 'Alta' : 'Baixa'),
    });
  };

  // 1. RSI Factor
  pushFactor(
    'RSI Momentum (Força Relativa)',
    r !== null ? (r < 52 ? 'Alta' : 'Baixa') : 'Neutro',
    r !== null ? (r < 40 || r > 60 ? 3 : 1) : 0
  );

  // 2. Stochastic Factor
  pushFactor(
    'Filtro Estocástico (Reversões Curtas)',
    st ? (st.k > st.d ? 'Alta' : 'Baixa') : 'Neutro',
    st ? 2 : 0
  );

  // 3. MACD Factor
  pushFactor(
    'Oscilador MACD (Cruzamento / Momentum)',
    md ? (md.macd > 0 ? 'Alta' : 'Baixa') : 'Neutro',
    md ? 2 : 0
  );

  // 4. Bollinger Bands Factor
  pushFactor(
    'Bandas de Bollinger (Suporte/Resistência)',
    bnd ? (last.c < (bnd.u + bnd.l) / 2 ? 'Alta' : 'Baixa') : 'Neutro',
    bnd ? 1 : 0
  );

  // 5. VWAP Factor
  pushFactor(
    'Preço vs Linha Média VWAP',
    vw ? (last.c > vw ? 'Alta' : 'Baixa') : 'Neutro',
    vw ? 1 : 0
  );

  // 6. Exponential Moving Averages (EMA 9/20)'
  pushFactor(
    'Médias Móveis Exponenciais (Tendência)',
    (e9 && e20v) ? (e9 > e20v ? 'Alta' : 'Baixa') : 'Neutro',
    2
  );

  // 7. Candlestick Patterns
  pushFactor(
    'Anatomia de Candlestick (Padrões de Reversão)',
    pat ? (pat.s > 0 ? 'Alta' : pat.s < 0 ? 'Baixa' : 'Neutro') : 'Neutro',
    pat ? Math.abs(pat.s) : 0
  );

  // 8. Multi-timeframe trend alignment (M2 & M5)
  pushFactor(
    'Alinhamento de Tendência Macro (M2 & M5)',
    mtBias,
    mtScore !== 0 ? 3 : 0
  );

  // 9. SMC Structure (CHoCH / BOS)
  pushFactor(
    'Estrutura de Mercado SMC (CHoCH/BOS)',
    msBias,
    msScoreValue !== 0 ? 3 : 0
  );

  // 10. Volume Flow (CVD Delta)
  pushFactor(
    'Fluxo de Ordens CVD (Volume Delta)',
    cvdBias,
    cvdScoreValue !== 0 ? 2 : 0
  );

  // Calculate alignment score out of 10 factors
  const confluenceScore = factors.filter((f) => f.aligned).length;
  const confluencePercentage = confluenceScore * 10;

  // Determine market regime Trend vs Range
  const atrVal = atr(ca1, 14);
  const relativeVol = atrVal && last.c ? (atrVal / last.c) * 100 : 0;
  
  let marketRegimeState: 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'NOISE' = 'RANGE';
  let regime = 'Lateralização Consolidadada';

  const bndWidth = bnd ? (bnd.u - bnd.l) / bnd.m : 0.001;

  if (relativeVol > 0.18) {
    marketRegimeState = 'NOISE';
    regime = 'Alta Volatilidade / Ruído ';
  } else if (relativeVol < 0.045 || bndWidth < 0.002) {
    marketRegimeState = 'RANGE';
    regime = 'Lateralização Estreita o (Acumulação)';
  } else if (e9 && e20v && e9 > e20v && last.c > e9) {
    marketRegimeState = 'TREND_UP';
    regime = 'Tendência Sólida de Alta';
  } else if (e9 && e20v && e9 < e20v && last.c < e9) {
    marketRegimeState = 'TREND_DOWN';
    regime = 'Tendência Sólida de Baixa';
  } else {
    marketRegimeState = 'RANGE';
    regime = 'Consolidação Dinâmica (Suporte / Resistência)';
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
    regime,
    confluenceScore,
    confluencePercentage,
    factors,
    marketRegimeState,
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

// ==========================================
// FASE 1: ADVANCED ANATOMY STATISTICS LOGIC
// ==========================================

export interface VwapBandsResult {
  vwap: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
  currentDeviation: number;
}

/**
 * Calculates VWAP and its 1 and 2 standard deviation bands
 */
export function vwapWithBands(ca: Candle[]): VwapBandsResult | null {
  if (ca.length === 0) return null;
  let sumPv = 0;
  let sumV = 0;
  
  // First pass to calculate VWAP
  for (const c of ca) {
    const tp = (c.h + c.l + c.c) / 3;
    sumPv += tp * c.v;
    sumV += c.v;
  }
  if (sumV === 0) return null;
  const vwapValue = sumPv / sumV;

  // Second pass to calculate volume-weighted standard deviation
  let sumSqDiffV = 0;
  for (const c of ca) {
    const tp = (c.h + c.l + c.c) / 3;
    sumSqDiffV += c.v * Math.pow(tp - vwapValue, 2);
  }
  const variance = sumSqDiffV / sumV;
  const stdDev = Math.sqrt(variance);

  // Return bands
  return {
    vwap: vwapValue,
    upper1: vwapValue + stdDev,
    lower1: vwapValue - stdDev,
    upper2: vwapValue + 2 * stdDev,
    lower2: vwapValue - 2 * stdDev,
    currentDeviation: stdDev
  };
}

export interface VolumeProfileBin {
  priceMin: number;
  priceMax: number;
  volume: number;
  isPoc: boolean;
}

export interface VolumeProfileResult {
  bins: VolumeProfileBin[];
  pocPrice: number;
}

/**
 * Groups volume into horizontal price buckets (Volume Profile / VPVR)
 */
export function calculateVolumeProfile(ca: Candle[], binsCount = 12): VolumeProfileResult | null {
  if (ca.length === 0) return null;
  const prices = ca.flatMap(c => [c.h, c.l, c.c]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceWidth = maxPrice - minPrice;

  if (priceWidth === 0) return null;
  const binSize = priceWidth / binsCount;

  // Allocate bins
  const bins: VolumeProfileBin[] = Array.from({ length: binsCount }, (_, idx) => {
    const pMin = minPrice + idx * binSize;
    return {
      priceMin: pMin,
      priceMax: pMin + binSize,
      volume: 0,
      isPoc: false
    };
  });

  // Distribute volume into bins based on candle action
  for (const c of ca) {
    const tp = (c.h + c.l + c.c) / 3;
    let bIdx = Math.floor((tp - minPrice) / binSize);
    if (bIdx >= binsCount) bIdx = binsCount - 1;
    if (bIdx < 0) bIdx = 0;
    bins[bIdx].volume += c.v;
  }

  // Find POC (Point of Control)
  let maxVol = -1;
  let pocIdx = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].volume > maxVol) {
      maxVol = bins[i].volume;
      pocIdx = i;
    }
  }

  if (bins[pocIdx]) {
    bins[pocIdx].isPoc = true;
  }

  const pocPrice = bins[pocIdx] ? (bins[pocIdx].priceMin + bins[pocIdx].priceMax) / 2 : minPrice;

  return {
    bins,
    pocPrice
  };
}

export interface CvdResult {
  cvdArr: number[];
  lastDelta: number;
  imbalance: 'BUY_PRESSURE' | 'SELL_PRESSURE' | 'NEUTRAL';
  imbalanceRatio: number;
}

/**
 * Computes Cumulative Volume Delta (CVD) based on candle split pressure simulation
 */
export function calculateCVD(ca: Candle[]): CvdResult | null {
  if (ca.length === 0) return null;
  const cvdArr: number[] = [];
  let runningCvd = 0;
  let lastDelta = 0;
  let lastBuyVol = 0;
  let lastSellVol = 0;

  for (const c of ca) {
    const range = c.h - c.l;
    const buyRatio = range === 0 ? 0.5 : (c.c - c.l) / range;
    const buyVol = c.v * buyRatio;
    const sellVol = c.v * (1 - buyRatio);
    const delta = buyVol - sellVol;

    runningCvd += delta;
    cvdArr.push(runningCvd);

    lastDelta = delta;
    lastBuyVol = buyVol;
    lastSellVol = sellVol;
  }

  let imbalance: CvdResult['imbalance'] = 'NEUTRAL';
  let imbalanceRatio = 1.0;
  
  if (lastSellVol > 0 && lastBuyVol / lastSellVol > 1.8) {
    imbalance = 'BUY_PRESSURE';
    imbalanceRatio = lastBuyVol / lastSellVol;
  } else if (lastBuyVol > 0 && lastSellVol / lastBuyVol > 1.8) {
    imbalance = 'SELL_PRESSURE';
    imbalanceRatio = lastSellVol / lastBuyVol;
  }

  return {
    cvdArr,
    lastDelta,
    imbalance,
    imbalanceRatio
  };
}

/**
 * Computes On-Balance Volume (OBV)
 */
export function calculateOBV(ca: Candle[]): number[] {
  if (ca.length === 0) return [];
  const obv: number[] = [0];
  for (let i = 1; i < ca.length; i++) {
    const diff = ca[i].c - ca[i - 1].c;
    let currentObv = obv[obv.length - 1];
    if (diff > 0) {
      currentObv += ca[i].v;
    } else if (diff < 0) {
      currentObv -= ca[i].v;
    }
    obv.push(currentObv);
  }
  return obv;
}

export interface MarketStructureResult {
  bosDetected: boolean;
  bosType: 'BULLISH' | 'BEARISH' | null;
  bosPrice: number | null;
  chochDetected: boolean;
  chochType: 'BULLISH' | 'BEARISH' | null;
  chochPrice: number | null;
  lastHH: number | null;
  lastLL: number | null;
  lastLH: number | null;
  lastHL: number | null;
}

/**
 * Detects Market Structure Breaks (BOS) and Changes of Character (CHoCH) over recent candles
 */
export function detectMarketStructure(ca: Candle[]): MarketStructureResult {
  const result: MarketStructureResult = {
    bosDetected: false,
    bosType: null,
    bosPrice: null,
    chochDetected: false,
    chochType: null,
    chochPrice: null,
    lastHH: null,
    lastLL: null,
    lastLH: null,
    lastHL: null
  };

  if (ca.length < 15) return result;

  // Let's identify swing highs and swing lows
  // Swing High is a point where High_i is greater than High_i-1 and High_i+1
  // Swing Low is a point where Low_i is lower than Low_i-1 and Low_i+1
  const swingHighs: { idx: number; price: number }[] = [];
  const swingLows: { idx: number; price: number }[] = [];

  for (let i = 2; i < ca.length - 2; i++) {
    const prev2 = ca[i - 2];
    const prev1 = ca[i - 1];
    const curr = ca[i];
    const next1 = ca[i + 1];
    const next2 = ca[i + 2];

    if (curr.h > prev1.h && curr.h > prev2.h && curr.h > next1.h && curr.h > next2.h) {
      swingHighs.push({ idx: i, price: curr.h });
    }
    if (curr.l < prev1.l && curr.l < prev2.l && curr.l < next1.l && curr.l < next2.l) {
      swingLows.push({ idx: i, price: curr.l });
    }
  }

  if (swingHighs.length >= 2) {
    const shSorted = [...swingHighs].sort((a,b) => b.price - a.price);
    result.lastHH = shSorted[0].price;
    result.lastLH = shSorted[shSorted.length - 1].price;
  }
  if (swingLows.length >= 2) {
    const slSorted = [...swingLows].sort((a,b) => a.price - b.price);
    result.lastLL = slSorted[0].price;
    result.lastHL = slSorted[slSorted.length - 1].price;
  }

  // To find CHoCH (Change of character):
  // If we were in a bearish trend (highs cowering down, i.e. LH) and the latest close breaks above the last swing high (LH)
  // that marks a BULLISH Change of Character
  // Or if we were in a bullish trend (HLs) and the latest close breaks down below the last swing low (HL), that's BEARISH CHoCH.
  const latestCandle = ca[ca.length - 1];
  const previousCandle = ca[ca.length - 2];

  if (swingHighs.length > 0) {
    const lastHigh = swingHighs[swingHighs.length - 1];
    // Break above the last swing high
    if (previousCandle.c <= lastHigh.price && latestCandle.c > lastHigh.price) {
      result.chochDetected = true;
      result.chochType = 'BULLISH';
      result.chochPrice = lastHigh.price;
    }
  }

  if (swingLows.length > 0 && !result.chochDetected) {
    const lastLow = swingLows[swingLows.length - 1];
    // Break below the last swing low
    if (previousCandle.c >= lastLow.price && latestCandle.c < lastLow.price) {
      result.chochDetected = true;
      result.chochType = 'BEARISH';
      result.chochPrice = lastLow.price;
    }
  }

  // Break of Structure (BOS): continuation break of HH we had established prior
  if (swingHighs.length > 1) {
    // Find highest swing high within prior index (except last 3 candles)
    const priorHighs = swingHighs.filter(s => s.idx < ca.length - 3);
    if (priorHighs.length > 0) {
      const highestPrior = Math.max(...priorHighs.map(h => h.price));
      if (previousCandle.c <= highestPrior && latestCandle.c > highestPrior) {
        result.bosDetected = true;
        result.bosType = 'BULLISH';
        result.bosPrice = highestPrior;
      }
    }
  }

  if (swingLows.length > 1 && !result.bosDetected) {
    const priorLows = swingLows.filter(s => s.idx < ca.length - 3);
    if (priorLows.length > 0) {
      const lowestPrior = Math.min(...priorLows.map(l => l.price));
      if (previousCandle.c >= lowestPrior && latestCandle.c < lowestPrior) {
        result.bosDetected = true;
        result.bosType = 'BEARISH';
        result.bosPrice = lowestPrior;
      }
    }
  }

  return result;
}


