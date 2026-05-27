/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { formatNumber, getOperabilityInfo } from '../utils/indicators';
import { TrendingUp, TrendingDown, RefreshCw, BarChart2, Hash, Layers, Gauge, Sparkles } from 'lucide-react';

interface MetricCardsProps {
  currentPrice: number | null;
  prevPrice: number | null;
  changePercent: number;
  atrValue: number | null;
  vwapValue: number | null;
  candlePattern: { n: string; s: number; d: string } | null;
  isLoading: boolean;
  candlesM1?: import('../types').Candle[];
}

export const MetricCards: React.FC<MetricCardsProps> = ({
  currentPrice,
  prevPrice,
  changePercent,
  atrValue,
  vwapValue,
  candlePattern,
  isLoading,
  candlesM1 = [],
}) => {
  const isRising = changePercent >= 0;
  const priceColor = currentPrice && prevPrice 
    ? (currentPrice >= prevPrice ? 'text-emerald-500' : 'text-rose-500')
    : 'text-zinc-100';

  // Compute our high-fidelity relative volatility and operability guidelines
  const opi = getOperabilityInfo(atrValue, currentPrice);

  // Volume diagnostics
  const last10Candles = candlesM1 ? candlesM1.slice(-10) : [];
  const total10mVolume = last10Candles.reduce((acc, c) => acc + (c.v || 0), 0);

  const prior10Candles = candlesM1 ? candlesM1.slice(-20, -10) : [];
  const prior10mVolume = prior10Candles.reduce((acc, c) => acc + (c.v || 0), 0);

  const volChangePercent = prior10mVolume > 0 
    ? ((total10mVolume - prior10mVolume) / prior10mVolume) * 100 
    : 0;

  const maxVol = last10Candles.length > 0 ? Math.max(...last10Candles.map(c => c.v || 0)) : 1;

  const formatVol = (val: number): string => {
    if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    return val.toFixed(0);
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6" id="kpi-panel">
      {/* 1. Preço Atual */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium font-sans">Preço Atual</span>
            <Hash className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className={`text-lg md:text-xl font-bold font-mono tracking-tight transition-colors duration-300 ${priceColor}`}>
            {currentPrice ? `$${formatNumber(currentPrice, 2)}` : '—'}
          </div>
        </div>
        <div className="text-[9px] text-zinc-500 mt-2 flex items-center gap-1 font-sans">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          Feed em Tempo Real
        </div>
      </div>

      {/* 2. Variação Sessão */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium font-sans">Variação M1</span>
            {isRising ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
            )}
          </div>
          <div className={`text-lg md:text-xl font-bold font-mono tracking-tight ${isRising ? 'text-emerald-500' : 'text-rose-500'}`}>
            {changePercent >= 0 ? '+' : ''}{formatNumber(changePercent, 3)}%
          </div>
        </div>
        <div className="text-[9px] text-zinc-500 mt-2 font-sans">
          Desde o início da sessão
        </div>
      </div>

      {/* 3. Volatilidade % */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium font-sans">Volatilidade (ATR %)</span>
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg md:text-xl font-bold font-mono tracking-tight text-zinc-100">
            {opi.relativeVol > 0 ? `${formatNumber(opi.relativeVol, 3)}%` : '—'}
          </div>
        </div>
        <div className="text-[9px] text-zinc-400 mt-2 font-mono truncate">
          Status: {opi.label}
        </div>
      </div>

      {/* 4. Recomendação Operativa */}
      <div className={`border rounded-xl p-4 flex flex-col justify-between hover:scale-[1.01] transition duration-200 ${opi.colorClass}`}>
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider opacity-80 font-medium font-sans">Recomendação</span>
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="text-sm md:text-base font-extrabold tracking-tight truncate leading-none mt-1">
            {opi.suitabilityLabel}
          </div>
        </div>
        <div className="text-[8.5px] opacity-75 mt-1 leading-tight font-sans">
          {opi.explanation}
        </div>
      </div>

      {/* 5. VWAP Balance */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium font-sans">VWAP</span>
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-lg md:text-xl font-bold font-mono tracking-tight text-zinc-100">
            {vwapValue ? `$${formatNumber(vwapValue, 1)}` : '—'}
          </div>
        </div>
        <div className="text-[9px] mt-2 font-semibold font-sans">
          {vwapValue && currentPrice ? (
            currentPrice > vwapValue ? (
              <span className="text-emerald-500 flex items-center gap-0.5">▲ Acima do VWAP</span>
            ) : (
              <span className="text-rose-500 flex items-center gap-0.5">▼ Abaixo do VWAP</span>
            )
          ) : (
            <span className="text-zinc-500 font-sans">Calculando...</span>
          )}
        </div>
      </div>

      {/* 6. Volume Acumulado de 10 min */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium font-sans">Vol Acumulado (10m)</span>
            <BarChart2 className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <div className="text-lg md:text-xl font-bold font-mono tracking-tight text-teal-300">
            {total10mVolume > 0 ? formatVol(total10mVolume) : '—'}
          </div>
        </div>
        <div className="flex items-center justify-between gap-1 mt-2">
          {last10Candles.length > 0 && (
            <div className="flex items-end gap-[2px] h-[14px]">
              {last10Candles.map((c, i) => {
                const heightPercent = maxVol > 0 ? ((c.v || 0) / maxVol) * 80 + 20 : 20;
                const isNewest = i === last10Candles.length - 1;
                return (
                  <div
                    key={i}
                    style={{ height: `${heightPercent}%` }}
                    className={`w-[3px] rounded-t-[1px] transition-all duration-300 ${
                      isNewest 
                        ? 'bg-teal-400 shadow-[0_-1px_3px_rgba(45,212,191,0.5)]' 
                        : 'bg-zinc-700 hover:bg-zinc-600'
                    }`}
                  />
                );
              })}
            </div>
          )}
          <span className={`text-[8px] font-mono hover:cursor-help ${volChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} title="Var. em relação ao bloco anterior de 10 minutos de volume">
            {volChangePercent >= 0 ? '▲' : '▼'}{Math.abs(volChangePercent).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 7. Padrão de Vela */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium font-sans">Padrão Vela</span>
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-500 ${isLoading ? 'animate-spin' : ''}`} />
          </div>
          <div className={`text-sm md:text-base font-bold truncate tracking-tight ${candlePattern ? (candlePattern.s > 0 ? 'text-emerald-500' : candlePattern.s < 0 ? 'text-rose-500' : 'text-zinc-300') : 'text-zinc-500'}`}>
            {candlePattern ? candlePattern.n : 'Nenhum'}
          </div>
        </div>
        <div className="text-[9px] text-zinc-400 mt-2 truncate max-w-full font-sans" title={candlePattern?.d || ''}>
          {candlePattern ? candlePattern.d : 'Sem padrão nos últimos candles'}
        </div>
      </div>
    </div>
  );
};

