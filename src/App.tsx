/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Candle, IndicatorScores, PredictionRecord, SelectedAsset } from './types';
import { fetchCandles, ASSET_MAP } from './utils/api';
import { score, formatNumber, stoch, macdData, getOperabilityInfo } from './utils/indicators';
import { TradingViewChart } from './components/TradingViewChart';
import { StochasticChart, MacdChart } from './components/TechnicalCanvas';
import { MetricCards } from './components/MetricCards';
import { PredictionBox } from './components/PredictionBox';
import { SignalsDetail } from './components/SignalsDetail';
import { PredictionHistory } from './components/PredictionHistory';
import { 
  PlusCircle, 
  Coins, 
  Clock, 
  RotateCw, 
  Cpu, 
  TrendingUp, 
  Info, 
  Compass,
  AlertTriangle,
  BrainCircuit,
  Sparkles
} from 'lucide-react';

export default function App() {
  // Main state models
  const [selectedSymbol, setSelectedSymbol] = useState<keyof typeof ASSET_MAP>('BTC/USD');
  const [selectedApi, setSelectedApi] = useState<'coders' | 'binance'>('coders');
  const [candlesM1, setCandlesM1] = useState<Candle[]>([]);
  const [candlesMacro, setCandlesMacro] = useState<Candle[]>([]);
  const [macroTimeframe, setMacroTimeframe] = useState<2 | 5>(5);
  const [indicatorScores, setIndicatorScores] = useState<IndicatorScores | null>(null);
  const [predictionHistory, setPredictionHistory] = useState<PredictionRecord[]>([]);
  
  // App cycle triggers
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(() => {
    const seconds = new Date().getSeconds();
    return seconds < 56 ? 56 - seconds : 116 - seconds;
  });
  
  // Track consecutive price changes for visually blinking colors
  const [prevClosePrice, setPrevClosePrice] = useState<number | null>(null);

  // Main states for AI Trading Assistant
  const [isDeepseekEnabled, setIsDeepseekEnabled] = useState(true);
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(true);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [latestAiAnalysis, setLatestAiAnalysis] = useState<{
    deepseek: {
      success: boolean;
      bullish: boolean | null;
      confidence: number | null;
      reasoning: string | null;
      error?: string;
    } | null;
    gemini: {
      success: boolean;
      bullish: boolean | null;
      confidence: number | null;
      reasoning: string | null;
      error?: string;
    } | null;
    asset: string;
    minute: number;
  } | null>(null);

  // Sync references to bypass stale closures in heartbeats/timers
  const isDeepseekEnabledRef = useRef(isDeepseekEnabled);
  const isGeminiEnabledRef = useRef(isGeminiEnabled);
  const latestAiAnalysisRef = useRef(latestAiAnalysis);
  const macroTimeframeRef = useRef(macroTimeframe);

  useEffect(() => {
    isDeepseekEnabledRef.current = isDeepseekEnabled;
  }, [isDeepseekEnabled]);

  useEffect(() => {
    isGeminiEnabledRef.current = isGeminiEnabled;
  }, [isGeminiEnabled]);

  useEffect(() => {
    latestAiAnalysisRef.current = latestAiAnalysis;
  }, [latestAiAnalysis]);

  useEffect(() => {
    macroTimeframeRef.current = macroTimeframe;
  }, [macroTimeframe]);

  // Interval reference trackers
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Triggers the 40s Deepseek / Gemini AI analytic model evaluation
   */
  const executeAiAnalysis = useCallback(async (forcedSymbol?: keyof typeof ASSET_MAP, forcedApi?: 'coders' | 'binance', forcedMacroTf?: 2 | 5) => {
    const sym = forcedSymbol || selectedSymbol;
    const api = forcedApi || selectedApi;
    const mtf = forcedMacroTf !== undefined ? forcedMacroTf : macroTimeframeRef.current;

    // If both AIs are disabled, skip computing & save resources
    if (!isDeepseekEnabledRef.current && !isGeminiEnabledRef.current) {
      setLatestAiAnalysis(null);
      setAiStatus('idle');
      return;
    }

    setAiStatus('loading');
    try {
      // 1. Fetch data strictly at 40s in parallel without updating active page charts
      const [m1Data, mMacroData] = await Promise.all([
        fetchCandles(1, 100, sym, api),
        fetchCandles(mtf, 30, sym, api),
      ]);

      if (m1Data.length === 0 || mMacroData.length === 0) {
        throw new Error(`Retornou matrizes de candles vazias no checkpoint de 40s para M${mtf}.`);
      }

      // Calculate dynamic support/resistance (20-period Donchian limits on M1)
      const recentM1Slices = m1Data.slice(-20);
      const lowPrices = recentM1Slices.map(c => c.l);
      const highPrices = recentM1Slices.map(c => c.h);
      const supportM1 = lowPrices.length > 0 ? Math.min(...lowPrices) : 0;
      const resistanceM1 = highPrices.length > 0 ? Math.max(...highPrices) : 0;

      // Calculate indicators score, signals list, and candle patterns
      const freshScores = score(m1Data, mMacroData, mtf);
      const signalsList = freshScores.sigs.map(s => s.lbl);
      const patString = freshScores.pat ? `${freshScores.pat.n}: ${freshScores.pat.d}` : 'Nenhum';

      // Volatility and operability status
      const atrVal = atr(m1Data);
      const currentPriceCp = m1Data[m1Data.length - 1]?.c || 0;
      const opInfo = getOperabilityInfo(atrVal, currentPriceCp);
      const volAtrPercent = atrVal && currentPriceCp ? (atrVal / currentPriceCp) * 100 : 0;

      // 2. Transmit candles info to the secure server-side API key proxy
      const response = await fetch('/api/analyze-deepseek', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: sym,
          m1: m1Data,
          m5: mMacroData,
          resolution: mtf,
          runDeepseek: isDeepseekEnabledRef.current,
          runGemini: isGeminiEnabledRef.current,
          technicalMetric: {
            supportM1,
            resistanceM1,
            indicatorScores: freshScores.tot,
            signals: signalsList,
            pattern: patString,
            volatilityAtrPercent: volAtrPercent,
            operabilityState: opInfo.state,
            operabilityLabel: opInfo.label,
            operabilitySuitability: opInfo.suitabilityLabel
          }
        })
      });

      if (!response.ok) {
        throw new Error(`O endpoint respondeu com status de erro ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('O endpoint não retornou JSON válido (o servidor pode estar reiniciando ou indisponível temporariamente).');
      }

      const resData = await response.json();
      if (resData && resData.success) {
        setLatestAiAnalysis({
          deepseek: resData.deepseek,
          gemini: resData.gemini,
          asset: sym,
          minute: new Date().getMinutes()
        });
        setAiStatus('success');
      } else {
        throw new Error(resData.error || 'Chamada falhou.');
      }
    } catch (err: any) {
      console.error('Falha ao obter analise do modelo de IA:', err);
      setAiStatus('error');
    }
  }, [selectedSymbol, selectedApi]);

  /**
   * Main function resolving technical forecasts on candles, combining AI if present
   */
  const handleTechnicalAnalysis = useCallback((c1: Candle[], cMacro: Candle[], mtfVal?: 2 | 5) => {
    if (c1.length === 0) return;
    
    const activeMtf = mtfVal !== undefined ? mtfVal : macroTimeframeRef.current;

    // 1. Calculate technical score results
    const scores = score(c1, cMacro, activeMtf);

    // Read synced ref parameters
    const activeAnalysis = latestAiAnalysisRef.current;
    const currentMinute = new Date().getMinutes();
    
    let deepseekActive = false;
    let deepseekSuccess = false;
    let deepseekBull: boolean | null = null;
    let deepseekConfidence: number | undefined = undefined;
    let deepseekReasoning: string | undefined = undefined;

    let geminiActive = false;
    let geminiSuccess = false;
    let geminiBull: boolean | null = null;
    let geminiConfidence: number | undefined = undefined;
    let geminiReasoning: string | undefined = undefined;

    // 1.1 Process Deepseek V3 prediction integration
    if (isDeepseekEnabledRef.current) {
      deepseekActive = true;
      if (activeAnalysis && activeAnalysis.asset === selectedSymbol && activeAnalysis.minute === currentMinute && activeAnalysis.deepseek?.success) {
        deepseekSuccess = true;
        deepseekBull = activeAnalysis.deepseek.bullish;
        deepseekConfidence = activeAnalysis.deepseek.confidence ?? undefined;
        deepseekReasoning = activeAnalysis.deepseek.reasoning ?? undefined;

        if (deepseekBull !== null) {
          scores.sigs.unshift({
            lbl: `I.A. (Deepseek V3): ${deepseekReasoning}`,
            sc: deepseekBull ? 3 : -3,
            badge: deepseekBull ? 'bul' : 'ber'
          });
        }
      }
    }

    // 1.2 Process Gemini 3.5 Flash prediction integration
    if (isGeminiEnabledRef.current) {
      geminiActive = true;
      if (activeAnalysis && activeAnalysis.asset === selectedSymbol && activeAnalysis.minute === currentMinute && activeAnalysis.gemini?.success) {
        geminiSuccess = true;
        geminiBull = activeAnalysis.gemini.bullish;
        geminiConfidence = activeAnalysis.gemini.confidence ?? undefined;
        geminiReasoning = activeAnalysis.gemini.reasoning ?? undefined;

        if (geminiBull !== null) {
          scores.sigs.unshift({
            lbl: `I.A. (Gemini 3.5): ${geminiReasoning}`,
            sc: geminiBull ? 3 : -3,
            badge: geminiBull ? 'bul' : 'ber'
          });
        }
      }
    }

    setIndicatorScores(scores);

    // 2. Evaluate previous prediction if one is registered and unresolved
    const latestClose = c1[c1.length - 1].c;
    
    setPredictionHistory((prevHistory) => {
      // Evaluate any pending predictions whose target candle is now fully loaded and closed in c1
      const updatedHistory = prevHistory.map((pendingPred) => {
        if (pendingPred.result !== null) return pendingPred;

        if (pendingPred.targetTs) {
          // A candle is fully closed once we have retrieved a newer candle in c1
          const latestCandle = c1[c1.length - 1];
          if (latestCandle && latestCandle.t > pendingPred.targetTs) {
            const matchCandle = c1.find((c) => c.t === pendingPred.targetTs);
            if (matchCandle) {
              // Check if the candle closed up (green) or down (red)
              const closedUp = matchCandle.c >= matchCandle.o;
              const correct = pendingPred.bull ? closedUp : !closedUp;
              return {
                ...pendingPred,
                result: correct,
              };
            }
          }
        } else {
          // Fallback legacy support
          if (latestClose !== pendingPred.cp) {
            const isHigher = latestClose > pendingPred.cp;
            const correct = pendingPred.bull ? isHigher : !isHigher;
            return {
              ...pendingPred,
              result: correct,
            };
          }
        }
        return pendingPred;
      });

      // 3. Register the new active prediction
      const now = new Date();
      // Em horário, colocamos o horário da previsão do próximo minuto cheio (target date)
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);
      const targetTs = Math.floor(targetDate.getTime() / 1000);
      const timeStr = targetDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      
      const bullSemIa = scores.tot >= 0;
      
      // Calculate Combined consensus score by summing technical score and active/successful AI inputs
      let aiOffset = 0;
      if (deepseekActive && deepseekSuccess && deepseekBull !== null) {
        aiOffset += deepseekBull ? 3 : -3;
      }
      if (geminiActive && geminiSuccess && geminiBull !== null) {
        aiOffset += geminiBull ? 3 : -3;
      }

      const combinedScore = scores.tot + aiOffset;
      const mathBullGeral = combinedScore >= 0;

      const newPrediction: PredictionRecord = {
        id: `${Date.now()}-${Math.random()}`,
        time: timeStr,
        ts: Math.floor(now.getTime() / 1000), // Execution timestamp
        targetTs: targetTs,
        cp: latestClose,
        bull: mathBullGeral, // GENERAL combined prediction determines win or loss
        bullSemIa: bullSemIa,
        bullComIa: deepseekBull !== null ? deepseekBull : geminiBull, // legacy compatible fallback
        
        deepseekActive,
        deepseekSuccess,
        deepseekBull,
        deepseekConfidence,
        deepseekReasoning,

        geminiActive,
        geminiSuccess,
        geminiBull,
        geminiConfidence,
        geminiReasoning,

        tot: scores.tot,
        result: null, // Resolves on subsequent heartbeat updates once fully closed
      };

      return [...updatedHistory, newPrediction];
    });
  }, [selectedSymbol]);

  /**
   * Main synchronous cycle fetching all needed candles
   */
  const executeUpdateCycle = useCallback(async (
    forcedSymbol?: keyof typeof ASSET_MAP, 
    forcedApi?: 'coders' | 'binance', 
    forcedMacroTf?: 2 | 5
  ) => {
    const sym = forcedSymbol || selectedSymbol;
    const api = forcedApi || selectedApi;
    const mtf = forcedMacroTf !== undefined ? forcedMacroTf : macroTimeframeRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    
    try {
      // Fetch 100 on M1 and 30 on designated macro timeframe in parallel
      const [m1Data, mMacroData] = await Promise.all([
        fetchCandles(1, 100, sym, api),
        fetchCandles(mtf, 30, sym, api),
      ]);

      if (m1Data.length === 0) {
        throw new Error('Não foi possível carregar os dados de candles M1 do mercado.');
      }

      // Preserve previous closing price for dynamic blink comparisons
      if (candlesM1.length > 0) {
        setPrevClosePrice(candlesM1[candlesM1.length - 1].c);
      } else {
        setPrevClosePrice(m1Data[m1Data.length - 1].o); // Fallback to starting Open
      }

      setCandlesM1(m1Data);
      setCandlesMacro(mMacroData);
      
      // Calculate scores
      handleTechnicalAnalysis(m1Data, mMacroData, mtf);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Falha ao sincronizar dados com o servidor de trading.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSymbol, selectedApi, candlesM1, handleTechnicalAnalysis]);

  // Load initial dataset on mount
  useEffect(() => {
    executeUpdateCycle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update timer ticks every second
  useEffect(() => {
    // Clear old timers
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    const lastSyncMinuteRef = { current: null as number | null };
    const lastAiSyncMinuteRef = { current: null as number | null };

    countdownIntervalRef.current = setInterval(() => {
      const now = new Date();
      const seconds = now.getSeconds();
      const currentMinute = now.getMinutes();

      // Countdown reports how many seconds until the next 56th second
      const remainingSeconds = seconds < 56 ? 56 - seconds : 116 - seconds;
      setCountdown(remainingSeconds);

      // Trigger automatic update cycle strictly at 56s of the current minute
      if (seconds === 56 && lastSyncMinuteRef.current !== currentMinute) {
        lastSyncMinuteRef.current = currentMinute;
        executeUpdateCycle();
      }

      // Trigger automatic AI analysis strictly at 40s of the current minute if active
      const someAiActive = isDeepseekEnabledRef.current || isGeminiEnabledRef.current;
      if (seconds === 40 && lastAiSyncMinuteRef.current !== currentMinute && someAiActive) {
        lastAiSyncMinuteRef.current = currentMinute;
        executeAiAnalysis();
      }
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [executeUpdateCycle, executeAiAnalysis]);

  // Switch assets with instant loading updates
  const handleAssetChange = (newSymbol: keyof typeof ASSET_MAP) => {
    setSelectedSymbol(newSymbol);
    setCandlesM1([]);
    setCandlesMacro([]);
    setIndicatorScores(null);
    setLatestAiAnalysis(null);
    setAiStatus('idle');
    // Persist history but let it adapt to the next assets
    executeUpdateCycle(newSymbol);
  };

  // Switch API data providers with instant loading updates
  const handleApiChange = (newApi: 'coders' | 'binance') => {
    setSelectedApi(newApi);
    setCandlesM1([]);
    setCandlesMacro([]);
    setIndicatorScores(null);
    setLatestAiAnalysis(null);
    setAiStatus('idle');
    executeUpdateCycle(selectedSymbol, newApi);
  };

  // Switch dynamic macro timeframe between 5m and 2m
  const handleMacroTimeframeChange = (newTf: 2 | 5) => {
    setMacroTimeframe(newTf);
    setCandlesMacro([]);
    setIndicatorScores(null);
    setLatestAiAnalysis(null);
    setAiStatus('idle');
    executeUpdateCycle(selectedSymbol, selectedApi, newTf);
  };

  const currentCandle = candlesM1[candlesM1.length - 1];
  const firstCandle = candlesM1[0];
  const priceChangePercent = currentCandle && firstCandle
    ? ((currentCandle.c - firstCandle.o) / firstCandle.o) * 100
    : 0;

  // Extract statistical metrics safely
  const currentPriceValue = currentCandle ? currentCandle.c : null;
  const atrValue = candlesM1.length > 0 ? candlesM1 : null; // mapped internally, wait!
  // Let's resolve indicators on the direct live states
  const latestAtr = candlesM1.length > 0 ? (candlesM1.length >= 15 ? atr(candlesM1) : null) : null;
  const latestVwap = candlesM1.length > 0 ? vwap(candlesM1) : null;
  
  // Pattern detail
  const latestPattern = indicatorScores ? indicatorScores.pat : null;

  return (
    <div className="bg-[#09090b] text-zinc-100 min-h-screen selection:bg-indigo-500/30 selection:text-indigo-200 flex flex-col font-sans">
      
      {/* 1. TOP PREMIUM HEADER */}
      <header className="border-b border-zinc-900 bg-zinc-950/85 backdrop-blur sticky top-0 z-50 px-4 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          
          {/* Logo & Platform Info */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold shadow-[0_0_15px_rgba(99,102,241,0.1)]">
              <Compass className="w-5.5 h-5.5 text-indigo-400 rotate-12" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold uppercase tracking-wider text-zinc-100 font-sans">
                  SISTEMA DE PREVISÕES DE TRADING
                </h1>
                <span className="bg-indigo-500/15 text-indigo-400 text-[9px] px-2 py-0.5 rounded-full font-bold border border-indigo-500/20 uppercase tracking-widest leading-none">
                  V2.4 Técnico
                </span>
              </div>
              <p className="text-[10.5px] text-zinc-400 mt-0.5 font-sans">
                Análise técnica dinâmica quantitativa operando em multi-candles M1 & M{macroTimeframe}
              </p>
            </div>
          </div>

          {/* Quick Stats, Countdown, Control actions */}
          <div className="flex items-center flex-wrap sm:flex-nowrap gap-4">
            
            {/* Auto refresh timer countdown */}
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800/80 px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>Próxima Vela em: </span>
              <span className="font-bold text-indigo-400 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800 tracking-wider">
                {countdown}s
              </span>
            </div>

            {/* Refresh action trigger */}
            <button 
              id="rbtn"
              onClick={() => executeUpdateCycle()}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 hover:cursor-pointer hover:bg-zinc-800 text-xs px-3.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 hover:text-indigo-300 font-sans font-medium transition duration-200 disabled:opacity-50 disabled:pointer-events-none shrink-0"
            >
              <RotateCw className={`w-3.5 h-3.5 text-indigo-400 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Carregando...' : 'Atualizar'}
            </button>
          </div>
        </div>
      </header>

      {/* 2. CORE VIEWPORT CONTENT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-6">
        
        {/* Error notification header */}
        {errorMessage && (
          <div className="bg-rose-950/40 border border-rose-500/20 text-rose-300 rounded-2xl p-4 flex gap-3 text-xs leading-relaxed" id="error-alert">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <div>
              <strong className="text-rose-200 font-semibold font-sans">Falha na Conexão de Mercado: </strong>
              <span>{errorMessage}</span>
              <p className="text-zinc-400 mt-1 font-sans">
                O painel de indicadores continuará buscando conexões ativas automaticamente. Nenhuma ação manual é exigida.
              </p>
            </div>
          </div>
        )}

        {/* API Selector Block (Data Provider) */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4" id="api-selector-panel">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <div>
              <span className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Fonte de Dados de Mercado</span>
              <h2 className="text-sm text-zinc-100 font-medium font-sans">Selecione o Endpoint da API de Conexão</h2>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { id: 'coders', name: 'API Premium (Coders-Master)', sub: 'Com Fallback' },
              { id: 'binance', name: 'API Spot Direta (Binance)', sub: 'Pública' }
            ].map((api) => {
              const active = selectedApi === api.id;
              return (
                <button
                  key={api.id}
                  onClick={() => handleApiChange(api.id as 'coders' | 'binance')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold border transition duration-200 flex items-center gap-2 hover:cursor-pointer ${
                    active 
                      ? 'bg-indigo-600 text-indigo-50 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.25)]' 
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-zinc-100' : 'bg-indigo-400'}`} />
                  {api.name}
                  <span className={`text-[9px] uppercase tracking-wider border-l ${active ? 'border-zinc-300 pl-1.5 opacity-80' : 'border-zinc-800 pl-1.5 opacity-60'}`}>
                    {api.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Assets Selector Block / Trading Pair Pills */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Coins className="w-5 h-5 text-indigo-400" />
            <div>
              <span className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Trading Pair</span>
              <h2 className="text-sm text-zinc-100 font-medium font-sans">Escolha o Ativo Fundamental para o Modelo</h2>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(ASSET_MAP) as Array<keyof typeof ASSET_MAP>).map((symbol) => {
              const active = selectedSymbol === symbol;
              const assetMeta = ASSET_MAP[symbol];
              return (
                <button
                  key={symbol}
                  onClick={() => handleAssetChange(symbol)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold border transition duration-200 flex items-center gap-2 hover:cursor-pointer ${
                    active 
                      ? 'bg-indigo-600 text-indigo-50 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.25)]' 
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-zinc-100' : 'bg-indigo-400'}`} />
                  {symbol}
                  <span className={`text-[9px] uppercase tracking-wider border-l ${active ? 'border-zinc-300 pl-1.5 opacity-80' : 'border-zinc-800 pl-1.5 opacity-60'}`}>
                    {assetMeta.codersSym.slice(0, 3)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tempo Gráfico Análise Macro (Switcher de M5 vs M2) */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4" id="macro-timeframe-selector">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-indigo-400" />
            <div>
              <span className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Tempo Gráfico de Análise Sincronizada</span>
              <h2 className="text-sm text-zinc-100 font-medium font-sans">Considere e sincronize a tendência secundária de M5 ou M2</h2>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { id: 5, name: 'M5 (Macro Tradicional)', desc: 'Padrão' },
              { id: 2, name: 'M2 (Macro Flexível)', desc: 'Alta Reatividade' }
            ].map((tf) => {
              const active = macroTimeframe === tf.id;
              return (
                <button
                  key={tf.id}
                  onClick={() => handleMacroTimeframeChange(tf.id as 2 | 5)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold border transition duration-200 flex items-center gap-2 hover:cursor-pointer ${
                    active 
                      ? 'bg-indigo-600 text-indigo-50 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.25)]' 
                      : 'bg-zinc-900 border-zinc-805 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-zinc-100' : 'bg-indigo-400'}`} />
                  {tf.name}
                  <span className={`text-[9px] uppercase tracking-wider border-l ${active ? 'border-zinc-300 pl-1.5 opacity-80' : 'border-zinc-800 pl-1.5 opacity-60'}`}>
                    {tf.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Copilot Settings Toggle Panel */}
        <div className="bg-zinc-950 border border-purple-500/20 rounded-2xl p-5 shadow-[0_4px_20px_rgba(139,92,246,0.05)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5" id="ai-settings-panel">
          <div className="flex items-start gap-4 flex-1">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border transition ${
              (isDeepseekEnabled || isGeminiEnabled) 
                ? 'bg-purple-950/45 border-purple-500/30 text-purple-400 shadow-[0_0_12px_rgba(139,92,246,0.15)]' 
                : 'bg-zinc-900 border-zinc-800 text-zinc-500'
            }`}>
              <BrainCircuit className={`w-6 h-6 ${(isDeepseekEnabled || isGeminiEnabled) ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-purple-400 font-bold font-mono">
                  Trading Assistido por Inteligência Artificial (Redes Neurais Paralelas)
                </span>
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  (isDeepseekEnabled || isGeminiEnabled) ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-zinc-900 text-zinc-500'
                }`}>
                  {(isDeepseekEnabled || isGeminiEnabled) ? 'Ativo' : 'Desativado'}
                </span>
              </div>
              <h2 className="text-sm text-zinc-100 font-medium font-sans mt-0.5">
                Copilotos Inteligentes Simultâneos: Deepseek V3 & Gemini 3.5 Flash
              </h2>
              <p className="text-[11px] text-zinc-400 leading-relaxed mt-1 max-w-2xl font-sans">
                Aos 40 segundos de cada minuto, os assistentes habilitados predizem simultaneamente se o próximo candle fechará em Alta ou Baixa com base nas forças de M1 e M{macroTimeframe}. Cada IA ativa e bem-sucedida fornece um viés ponderado de <strong className="text-zinc-250">+3 ou -3 pontos</strong> para o Consenso Geral. Se uma falhar ou estiver desligada, o sistema segue sem sua informação.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 border-t border-zinc-900 pt-4 lg:border-t-0 lg:pt-0 shrink-0">
            {/* Real-time AI execution trace logger status visual */}
            <div className="flex flex-col gap-1.5 font-mono text-[11px] min-w-[210px] bg-zinc-900/50 border border-zinc-850 px-3.5 py-2.5 rounded-xl">
              <span className="text-[9.5px] uppercase tracking-wider text-zinc-400 font-bold">Status do Copiloto AI (40s):</span>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  (!isDeepseekEnabled && !isGeminiEnabled) ? 'bg-zinc-600' :
                  aiStatus === 'idle' ? 'bg-cyan-500 animate-pulse' :
                  aiStatus === 'loading' ? 'bg-purple-500 animate-spin border border-dashed border-zinc-100' :
                  aiStatus === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
                }`} />
                <span className={`font-semibold ${
                  (!isDeepseekEnabled && !isGeminiEnabled) ? 'text-zinc-500' :
                  aiStatus === 'idle' ? 'text-cyan-400' :
                  aiStatus === 'loading' ? 'text-purple-400 animate-pulse' :
                  aiStatus === 'success' ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(!isDeepseekEnabled && !isGeminiEnabled) ? 'Copilotos de IA Inativos' :
                   aiStatus === 'idle' ? 'Aguardando 40 Segundos...' :
                   aiStatus === 'loading' ? 'IA Computando Análise...' :
                   aiStatus === 'success' ? 'Análises Paralelas Concluídas!' : 'Falha parcial ou total detectada'}
                </span>
              </div>
            </div>

            {/* Individual Switches Toggles Container */}
            <div className="flex flex-col gap-3.5 bg-zinc-900/40 p-3 rounded-xl border border-zinc-850 min-w-[200px]">
              {/* Deepseek Switch */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-mono font-bold text-teal-400 uppercase tracking-widest">DS V3</span>
                <button
                  id="deepseek-toggle-switch"
                  onClick={() => {
                    const nextVal = !isDeepseekEnabled;
                    setIsDeepseekEnabled(nextVal);
                    if (!nextVal && !isGeminiEnabled) {
                      setLatestAiAnalysis(null);
                      setAiStatus('idle');
                    }
                  }}
                  className={`hover:cursor-pointer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                    isDeepseekEnabled ? 'bg-teal-500' : 'bg-zinc-800'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ${
                    isDeepseekEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {/* Gemini Switch */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-mono font-bold text-indigo-400 uppercase tracking-widest">GEMINI 3.5</span>
                <button
                  id="gemini-toggle-switch"
                  onClick={() => {
                    const nextVal = !isGeminiEnabled;
                    setIsGeminiEnabled(nextVal);
                    if (!nextVal && !isDeepseekEnabled) {
                      setLatestAiAnalysis(null);
                      setAiStatus('idle');
                    }
                  }}
                  className={`hover:cursor-pointer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                    isGeminiEnabled ? 'bg-indigo-500' : 'bg-zinc-800'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ${
                    isGeminiEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* AI Active Forecast Highlight Row for active predictions */}
        {(isDeepseekEnabled || isGeminiEnabled) && latestAiAnalysis && (
          <div className="bg-zinc-950 border border-purple-500/20 p-5 rounded-2xl flex flex-col gap-4 animate-in fade-in duration-300" id="latest-ai-insight">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400 shrink-0" />
              <span className="text-[10px] uppercase font-bold tracking-wider text-purple-400 font-mono">
                Painel de Co-Múltiplos Insights obtidos aos 40s (Vela Alvo: {latestAiAnalysis.minute + 1})
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Deepseek Box */}
              {isDeepseekEnabled && (
                <div className="bg-zinc-900/50 border border-zinc-805 p-3.5 rounded-xl flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-teal-400 font-mono">Deepseek V3</span>
                    {latestAiAnalysis.deepseek?.success ? (
                      <div>
                        <p className="text-xs text-zinc-100 mt-1 font-semibold">
                          Previsão: <strong className={latestAiAnalysis.deepseek.bullish ? 'text-emerald-400' : 'text-rose-400'}>
                            {latestAiAnalysis.deepseek.bullish ? '▲ ALTA (COMPRA)' : '▼ BAIXA (VENDA)'}
                          </strong> · Confiança: <strong>{latestAiAnalysis.deepseek.confidence}%</strong>
                        </p>
                        <p className="text-[11px] text-zinc-400 italic mt-1">"{latestAiAnalysis.deepseek.reasoning}"</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-rose-400 mt-1">
                        {latestAiAnalysis.deepseek?.error ? `Falhou: ${latestAiAnalysis.deepseek.error}` : 'Aguardando próximo ciclo de predição...'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Gemini Box */}
              {isGeminiEnabled && (
                <div className="bg-zinc-900/50 border border-zinc-805 p-3.5 rounded-xl flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 font-mono">Gemini 3.5 Flash</span>
                    {latestAiAnalysis.gemini?.success ? (
                      <div>
                        <p className="text-xs text-zinc-100 mt-1 font-semibold">
                          Previsão: <strong className={latestAiAnalysis.gemini.bullish ? 'text-emerald-400' : 'text-rose-400'}>
                            {latestAiAnalysis.gemini.bullish ? '▲ ALTA (COMPRA)' : '▼ BAIXA (VENDA)'}
                          </strong> · Confiança: <strong>{latestAiAnalysis.gemini.confidence}%</strong>
                        </p>
                        <p className="text-[11px] text-zinc-400 italic mt-1 font-sans">"{latestAiAnalysis.gemini.reasoning}"</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-rose-400 mt-1">
                        {latestAiAnalysis.gemini?.error ? `Falhou: ${latestAiAnalysis.gemini.error}` : 'Aguardando próximo ciclo de predição...'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Top quantitative metrics KPI panel */}
        <MetricCards 
          currentPrice={currentPriceValue}
          prevPrice={prevClosePrice}
          changePercent={priceChangePercent}
          atrValue={latestAtr}
          vwapValue={latestVwap}
          candlePattern={latestPattern}
          isLoading={isLoading}
          candlesM1={candlesM1}
        />

        {/* 3. MULTI-COLUMN TECHNICAL WORKSPACE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT AREA: Candlestick, Stochastic Oscillator & MACD Charts (7 of 12 columns) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Visual Candlestick view */}
            <TradingViewChart candles={candlesM1} />

            {/* Sub-Indicators charts (Stochastic and MACD stacked layout) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Stochastic Oscillator vector canvas card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden" id="stochastic-diagram-panel">
                <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-200 uppercase tracking-wider font-sans">
                    Estocástico Lento (14, 3) 
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">Zonas: 20 / 80</span>
                </div>
                <div className="h-[120px] p-4 bg-zinc-950">
                  <StochasticChart data={candlesM1.length > 0 ? getRawStoch(candlesM1) : null} />
                </div>
              </div>

              {/* MACD lines and Histogram vector canvas card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden" id="macd-diagram-panel">
                <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-200 uppercase tracking-wider font-sans">
                    MACD (12, 26, 9)
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">Centro Zero</span>
                </div>
                <div className="h-[120px] p-4 bg-zinc-950">
                  <MacdChart data={candlesM1.length > 0 ? getRawMacd(candlesM1) : null} />
                </div>
              </div>

            </div>
          </div>

          {/* RIGHT AREA: Predictions Consensus scorecard & active Signal Breakdown panels (5 of 12 columns) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Prediction engine summary header */}
            <div className="flex items-center gap-2 mb-1 pl-1">
              <Cpu className="w-4.5 h-4.5 text-indigo-400 shrink-0" />
              <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold font-sans">
                Consenso de Previsão Técnica
              </h2>
            </div>
            
            {/* Consolidated Forecast card */}
            <PredictionBox scores={indicatorScores} macroTimeframe={macroTimeframe} />

            {/* Individual signals importance list */}
            <SignalsDetail signals={indicatorScores ? indicatorScores.sigs : []} />
          </div>

        </div>

        {/* 4. FOOTER: SYSTEM ACCURACY LOGS TABLE CARD */}
        <PredictionHistory history={predictionHistory} />

        {/* Disclaimer footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-zinc-500 border-t border-zinc-900/80 pt-6 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Integridade Matemática Garantida por Binance Spot API Failover</span>
          </div>
          <div>
            Desenvolvido em React + Tailwind CSS · Não é assessoria ou recomendação financeira profissional
          </div>
        </div>

      </main>
    </div>
  );
}

/**
 * Technical mathematical wrapper functions bridging component inputs
 */
function getRawStoch(ca: Candle[]) {
  // Simple module resolver
  const { kA, dA, k, d } = stoch(ca) || { kA: [], dA: [], k: 50, d: 50 };
  return { kA, dA, k, d };
}

function getRawMacd(ca: Candle[]) {
  const cl = ca.map((c) => c.c);
  const data = macdData(cl);
  return data;
}

// Low level helpers
function atr(ca: Candle[], p = 14): number | null {
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

function vwap(ca: Candle[]): number | null {
  let sp = 0;
  let sv = 0;
  for (const c of ca) {
    const tp = (c.h + c.l + c.c) / 3;
    sp += tp * c.v;
    sv += c.v;
  }
  return sv ? sp / sv : null;
}

