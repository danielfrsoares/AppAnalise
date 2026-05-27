/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StochResult, MacdResult, formatNumber } from '../utils/indicators';

interface StochasticChartProps {
  data: StochResult | null;
}

export const StochasticChart: React.FC<StochasticChartProps> = ({ data }) => {
  if (!data || !data.kA || data.kA.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-xs font-mono">
        Buscando dados do estocástico...
      </div>
    );
  }

  const kPoints = data.kA.slice(-50);
  const dPoints = data.dA.slice(-50);
  const len = kPoints.length;

  const w = 600;
  const h = 100;
  
  // Map stochastic value 0-100 to SVG space (where Y=h is bottom, Y=0 is top)
  const mapY = (val: number) => h - (val / 100) * h;
  const mapX = (index: number) => (index / (len - 1)) * w;

  // Path generator
  const getPathData = (points: number[]) => {
    return points
      .map((val, idx) => `${idx === 0 ? 'M' : 'L'} ${formatNumberForSvg(mapX(idx))} ${formatNumberForSvg(mapY(val))}`)
      .join(' ');
  };

  const kPath = getPathData(kPoints);
  const dPath = getPathData(dPoints);

  return (
    <div className="w-full h-full relative font-mono">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-full overflow-visible"
        preserveAspectRatio="none"
      >
        {/* Shaded Oversold / Overbought Zones (20 to 80 area) */}
        <rect
          x="0"
          y={mapY(80)}
          width={w}
          height={mapY(20) - mapY(80)}
          fill="rgba(128, 128, 128, 0.05)"
        />
        
        {/* 80% and 20% Dotted Reference Lines */}
        <line
          x1="0"
          y1={mapY(80)}
          x2={w}
          y2={mapY(80)}
          stroke="rgba(239, 68, 68, 0.25)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <line
          x1="0"
          y1={mapY(20)}
          x2={w}
          y2={mapY(20)}
          stroke="rgba(16, 185, 129, 0.25)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />

        {/* Level Labels inside diagram */}
        <text x="5" y={mapY(80) - 3} fill="rgba(239, 68, 68, 0.5)" fontSize="9" fontWeight="bold">80 (SL/SC)</text>
        <text x="5" y={mapY(20) + 10} fill="rgba(16, 185, 129, 0.5)" fontSize="9" fontWeight="bold">20 (SV)</text>

        {/* %D Line (Amber, Dashed) */}
        <path
          d={dPath}
          fill="none"
          stroke="#ef9f27"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* %K Line (Azure, Solid) */}
        <path
          d={kPath}
          fill="none"
          stroke="#378add"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      
      {/* Floating details badge in bottom grid row */}
      <div className="absolute right-2 top-2 flex items-center gap-3 text-[10px] bg-zinc-900/80 backdrop-blur px-2 py-0.5 rounded border border-zinc-800">
        <span className="flex items-center gap-1.5 text-[#378add]">
          <span className="w-2 h-2 rounded-full bg-[#378add]" />
          %K: {formatNumber(data.k, 1)}
        </span>
        <span className="flex items-center gap-1.5 text-[#ef9f27]">
          <span className="w-2 h-2 rounded-full bg-[#ef9f27]" />
          %D: {formatNumber(data.d, 1)}
        </span>
      </div>
    </div>
  );
};

interface MacdChartProps {
  data: MacdResult | null;
}

export const MacdChart: React.FC<MacdChartProps> = ({ data }) => {
  if (!data || !data.hA || data.hA.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-xs font-mono">
        Buscando dados do MACD...
      </div>
    );
  }

  const macdHists = data.hA.slice(-50);
  const macdMacds = data.ml.slice(-50);
  const macdSignals = data.sg.slice(-50);
  const len = macdHists.length;

  const w = 600;
  const h = 100;

  // Let's compute exact bounds to avoid cropping and draw dynamic zero coordinates
  const absArray = [...macdHists, ...macdMacds, ...macdSignals].map(Math.abs);
  const maxAbs = Math.max(...absArray, 0.01) * 1.05; // 5% breathing padding

  // Map to SVG coordinates with 0 line in exact center vertically
  // Max value maps to Y=5, Min value (negative max) maps to Y=h-5
  const mapY = (val: number) => {
    const ratio = val / maxAbs; // from -1 to +1
    return h / 2 - (ratio * h) / 2.2;
  };
  const mapX = (index: number) => (index / (len - 1)) * w;

  const getPathData = (points: number[]) => {
    return points
      .map((val, idx) => `${idx === 0 ? 'M' : 'L'} ${formatNumberForSvg(mapX(idx))} ${formatNumberForSvg(mapY(val))}`)
      .join(' ');
  };

  const macdLinePath = getPathData(macdMacds);
  const signalLinePath = getPathData(macdSignals);

  return (
    <div className="w-full h-full relative font-mono">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-full overflow-visible"
        preserveAspectRatio="none"
      >
        {/* Zero baseline */}
        <line
          x1="0"
          y1={mapY(0)}
          x2={w}
          y2={mapY(0)}
          stroke="rgba(128, 128, 128, 0.15)"
          strokeWidth="1"
        />

        {/* Histogram Bars */}
        {macdHists.map((val, idx) => {
          const x = mapX(idx);
          const yZero = mapY(0);
          const yVal = mapY(val);
          const barWidth = Math.max(1.5, w / len - 3);
          const isBull = val >= 0;

          return (
            <line
              key={idx}
              x1={x}
              y1={yZero}
              x2={x}
              y2={yVal}
              stroke={isBull ? 'rgba(29, 158, 117, 0.65)' : 'rgba(216, 90, 48, 0.65)'}
              strokeWidth={barWidth}
            />
          );
        })}

        {/* MACD Line (Azure) */}
        <path
          d={macdLinePath}
          fill="none"
          stroke="#378add"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Signal Line (Amber, Dashed) */}
        <path
          d={signalLinePath}
          fill="none"
          stroke="#ef9f27"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Floating details badge in bottom grid row */}
      <div className="absolute right-2 top-2 flex items-center gap-2 text-[10px] bg-zinc-900/80 backdrop-blur px-2 py-0.5 rounded border border-zinc-800">
        <span className="flex items-center gap-1.5 text-[#378add]">
          <span className="w-2 h-2 rounded-full bg-[#378add]" />
          MACD: {formatNumber(data.macd, 2)}
        </span>
        <span className="flex items-center gap-1.5 text-[#ef9f27]">
          <span className="w-2 h-2 rounded-full bg-[#ef9f27]" />
          Sinal: {formatNumber(data.sig, 2)}
        </span>
        <span className="text-zinc-400">
          Hist: {formatNumber(data.hist, 2)}
        </span>
      </div>
    </div>
  );
};

// Internal utility to serialize simple SVG floats nicely
function formatNumberForSvg(num: number): string {
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}
