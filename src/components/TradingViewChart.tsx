/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { Candle } from '../types';
import { emaArr, formatNumber } from '../utils/indicators';
import { AreaChart } from 'lucide-react';

interface TradingViewChartProps {
  candles: Candle[];
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({ candles }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const ema9SeriesRef = useRef<any>(null);
  const ema20SeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Create the lightweight chart workspace
    const chart: any = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 240,
      layout: {
        background: { type: ColorType.Solid, color: '#09090b' }, // matches zinc-950
        textColor: '#a1a1aa', // matches zinc-400
      },
      grid: {
        vertLines: { color: 'rgba(39, 39, 42, 0.4)' }, // zinc-800 low level opacity
        horzLines: { color: 'rgba(39, 39, 42, 0.4)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(63, 63, 70, 0.4)', // zinc-700
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(63, 63, 70, 0.4)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: '#6366f1',
          width: 1,
          style: 3, // dotted
        },
        horzLine: {
          color: '#6366f1',
          width: 1,
          style: 3, // dotted
        },
      },
    });

    // 2. Add Candlestick Series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', // emerald-500
      downColor: '#ef4444', // rose-500
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // 3. Add Line Series for Technical Indicators (EMA 9 and EMA 20)
    const ema9Series = chart.addSeries(LineSeries, {
      color: '#f59e0b', // amber-500
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'EMA 9',
    });

    const ema20Series = chart.addSeries(LineSeries, {
      color: '#3b82f6', // blue-500
      lineWidth: 1.5,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'EMA 20',
    });

    // Save refs for incremental updates
    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    ema9SeriesRef.current = ema9Series;
    ema20SeriesRef.current = ema20Series;

    // Handle ResizeObserver for responsive resizing
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !chartContainerRef.current) return;
      chart.resize(chartContainerRef.current.clientWidth, 240);
    });
    resizeObserver.observe(chartContainerRef.current);

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update chart data whenever candles change
  useEffect(() => {
    if (
      !candles ||
      candles.length === 0 ||
      !candlestickSeriesRef.current ||
      !ema9SeriesRef.current ||
      !ema20SeriesRef.current ||
      !chartRef.current
    ) {
      return;
    }

    // Map candles to TradingView expected structure
    const chartData = candles.map((c) => ({
      time: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    candlestickSeriesRef.current.setData(chartData);

    // Draw Exponential Moving Averages
    const closePrices = candles.map((c) => c.c);
    const ema9Values = emaArr(closePrices, 9);
    const ema20Values = emaArr(closePrices, 20);

    const ema9Data = ema9Values.map((val, idx) => ({
      time: candles[candles.length - ema9Values.length + idx].t,
      value: val,
    }));

    const ema20Data = ema20Values.map((val, idx) => ({
      time: candles[candles.length - ema20Values.length + idx].t,
      value: val,
    }));

    ema9SeriesRef.current.setData(ema9Data);
    ema20SeriesRef.current.setData(ema20Data);

    // Auto-fit contents nicely
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  const latestCandle = candles[candles.length - 1];

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 overflow-hidden" id="candlestick-chart-panel">
      {/* Chart meta info row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <AreaChart className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-xs text-zinc-200 uppercase tracking-wider font-sans">
            Visualizador Candlestick M1
          </span>
        </div>
        {latestCandle && (
          <div className="text-[10px] sm:text-xs font-mono text-zinc-400 flex items-center justify-between bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-lg gap-3">
            <span>A: <strong className="text-zinc-100">${formatNumber(latestCandle.o, 2)}</strong></span>
            <span>M: <strong className="text-emerald-400">${formatNumber(latestCandle.h, 2)}</strong></span>
            <span>B: <strong className="text-rose-400">${formatNumber(latestCandle.l, 2)}</strong></span>
            <span>F: <strong className="text-zinc-100">${formatNumber(latestCandle.c, 2)}</strong></span>
          </div>
        )}
      </div>

      {/* Main TradingView viewport container */}
      <div 
        ref={chartContainerRef}
        className="w-full relative bg-zinc-950 rounded-xl"
        style={{ height: '240px' }}
      />

      {/* Legend guide flags */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] mt-3 border-t border-zinc-900 pt-3 text-zinc-400 font-mono">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-[#f59e0b]" />
          <span>EMA 9 (Média Rápida)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-[#3b82f6] border-t border-dashed" />
          <span>EMA 20 (Média de Tendência)</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="w-2 h-2 rounded bg-emerald-500" />
          <span>Alta</span>
          <span className="w-2 h-2 rounded bg-rose-500 ml-1.5" />
          <span>Baixa</span>
        </div>
      </div>
    </div>
  );
};
