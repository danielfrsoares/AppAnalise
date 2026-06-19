/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Candle, IndicatorScores, PredictionRecord } from './types';
import { fetchCandles, ASSET_MAP } from './utils/api';
import { 
  score, 
  formatNumber, 
  getOperabilityInfo,
  calculateVolumeProfile,
  vwapWithBands,
  calculateCVD,
  detectMarketStructure,
  stoch,
  macdData,
} from './utils/indicators';
import { PredictionHistory } from './components/PredictionHistory';
import { 
  Coins, 
  RotateCw, 
  AlertTriangle,
  Search,
  Compass,
  Clock,
} from 'lucide-react';

export default function App() {
  // Main states including the selected symbols for multi-asset
  const [selectedSymbols, setSelectedSymbols] = useState<Array<keyof typeof ASSET_MAP>>(['BTC/USD']);
  const [selectedApi] = useState<'coders' | 'binance'>('binance');
  
  // This state maps each symbol to its technical and AI state
  const [assetsStates, setAssetsStates] = useState<Record<string, {
    candlesM1: Candle[];
    candlesM2: Candle[];
    candlesM5: Candle[];
    indicatorScores: IndicatorScores | null;
    latestAiAnalysis: any;
    aiStatus: 'idle' | 'loading' | 'success' | 'error' | 'confluence_not_met';
    prevClosePrice: number | null;
    currentPriceValue: number | null;
    priceChangePercent: number;
  }>>({});

  const [predictionHistory, setPredictionHistory] = useState<PredictionRecord[]>([]);
  const [minConfluence, setMinConfluence] = useState<number>(70);
  
  // Asset selection category and search state
  const [assetSearch, setAssetSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  
  // App cycle triggers
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(() => {
    const seconds = new Date().getSeconds();
    return seconds < 52 ? 52 - seconds : 112 - seconds;
  });

  // Main states for AI Trading Assistant
  const [isDeepseekEnabled, setIsDeepseekEnabled] = useState(true);
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(true);

  // Sync references to bypass stale closures in heartbeats/timers
  const isDeepseekEnabledRef = useRef(isDeepseekEnabled);
  const isGeminiEnabledRef = useRef(isGeminiEnabled);
  const selectedSymbolsRef = useRef(selectedSymbols);
  const selectedApiRef = useRef(selectedApi);
  const minConfluenceRef = useRef(minConfluence);

  useEffect(() => {
    isDeepseekEnabledRef.current = isDeepseekEnabled;
  }, [isDeepseekEnabled]);

  useEffect(() => {
    isGeminiEnabledRef.current = isGeminiEnabled;
  }, [isGeminiEnabled]);

  useEffect(() => {
    selectedSymbolsRef.current = selectedSymbols;
  }, [selectedSymbols]);

  useEffect(() => {
    selectedApiRef.current = selectedApi;
  }, [selectedApi]);

  useEffect(() => {
    minConfluenceRef.current = minConfluence;
  }, [minConfluence]);

  // Interval reference trackers
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Triggers the AI analytic model evaluation for a specific asset with shared cached candle datasets
   */
  const executeAiAnalysis = useCallback(async (
    sym: keyof typeof ASSET_MAP,
    m1Data: Candle[],
    m2Data: Candle[],
    m5Data: Candle[],
    m15Data: Candle[],
    h1Data: Candle[]
  ) => {
    // If both AIs are disabled, skip computing & save resources
    if (!isDeepseekEnabledRef.current && !isGeminiEnabledRef.current) {
      return null;
    }

    try {
      if (!m1Data || m1Data.length === 0 || !m2Data || m2Data.length === 0 || !m5Data || m5Data.length === 0) {
        throw new Error('Retornou matrizes de candles vazias.');
      }

      // Calculate dynamic support/resistance (20-period Donchian limits on M1)
      const recentM1Slices = m1Data.slice(-20);
      const lowPrices = recentM1Slices.map(c => c.l);
      const highPrices = recentM1Slices.map(c => c.h);
      const supportM1 = lowPrices.length > 0 ? Math.min(...lowPrices) : 0;
      const resistanceM1 = highPrices.length > 0 ? Math.max(...highPrices) : 0;

      // Calculate indicators score, signals list, and candle patterns
      const freshScores = score(m1Data, m2Data, m5Data);
      const signalsList = freshScores.sigs.map(s => s.lbl);
      const patString = freshScores.pat ? `${freshScores.pat.n}: ${freshScores.pat.d}` : 'Nenhum';

      // Volatility and operability status
      const atrVal = atr(m1Data);
      const currentPriceCp = m1Data[m1Data.length - 1]?.c || 0;
      const opInfo = getOperabilityInfo(atrVal, currentPriceCp);
      const volAtrPercent = atrVal && currentPriceCp ? (atrVal / currentPriceCp) * 100 : 0;

      // Calculate advanced SMC / Order Flow metrics
      const vp = calculateVolumeProfile(m1Data, 12);
      const vwb = vwapWithBands(m1Data);
      const cvdMetric = calculateCVD(m1Data);
      const ms = detectMarketStructure(m1Data);

      // 2. Transmit candles info to the secure server-side API key proxy
      const response = await fetch('/api/analyze-deepseek', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: sym,
          m1: m1Data,
          m5: m5Data,
          m15: m15Data,
          h1: h1Data,
          resolution: 5,
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
            operabilitySuitability: opInfo.suitabilityLabel,
            
            // Advanced SMC metrics
            pocPrice: vp?.pocPrice || 0,
            vwapBase: vwb?.vwap || 0,
            vwapLower1: vwb?.lower1 || 0,
            vwapUpper1: vwb?.upper1 || 0,
            vwapLower2: vwb?.lower2 || 0,
            vwapUpper2: vwb?.upper2 || 0,
            cvdLastDelta: cvdMetric?.lastDelta || 0,
            cvdImbalance: cvdMetric?.imbalance || 'NEUTRAL',
            chochDetected: ms.chochDetected,
            chochType: ms.chochType,
            chochPrice: ms.chochPrice,
            bosDetected: ms.bosDetected,
            bosType: ms.bosType,
            bosPrice: ms.bosPrice
          }
        })
      });

      if (!response.ok) {
        throw new Error(`O endpoint respondeu com status de erro ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('O endpoint não retornou JSON válido.');
      }

      const resData = await response.json();
      if (resData && resData.success) {
        return {
          deepseek: resData.deepseek,
          gemini: resData.gemini,
          asset: sym,
          minute: new Date().getMinutes()
        };
      } else {
        throw new Error(resData.error || 'Chamada falhou.');
      }
    } catch (err: any) {
      console.error(`Falha ao obter analise do modelo de IA para ${sym}:`, err);
      return {
        deepseek: { success: false, bullish: null, confidence: null, reasoning: null, error: err.message },
        gemini: { success: false, bullish: null, confidence: null, reasoning: null, error: err.message },
        asset: sym,
        minute: new Date().getMinutes()
      };
    }
  }, []);

  /**
   * Main function resolving technical forecasts on candles, combining AI if present
   */
  const handleTechnicalAnalysis = useCallback((
    sym: keyof typeof ASSET_MAP,
    c1: Candle[], 
    cM2: Candle[], 
    cM5: Candle[], 
    scores: IndicatorScores,
    activeAnalysis?: any
  ) => {
    if (c1.length === 0) return;
    
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
      if (activeAnalysis && activeAnalysis.asset === sym && activeAnalysis.minute === currentMinute && activeAnalysis.deepseek?.success) {
        const confVal = activeAnalysis.deepseek.confidence ?? 0;
        if (confVal >= minConfluenceRef.current) {
          deepseekSuccess = true;
          deepseekBull = activeAnalysis.deepseek.bullish;
          deepseekConfidence = confVal;
          deepseekReasoning = activeAnalysis.deepseek.reasoning ?? undefined;

          if (deepseekBull !== null) {
            scores.sigs.unshift({
              lbl: `I.A. (Deepseek V3): ${deepseekReasoning}`,
              sc: deepseekBull ? 3 : -3,
              badge: deepseekBull ? 'bul' : 'ber'
            });
          }
        } else {
          deepseekSuccess = false;
          deepseekReasoning = `Descartado: Confiança de IA de ${confVal}% menor que a confluência mínima de ${minConfluenceRef.current}%`;
        }
      }
    }

    // 1.2 Process Gemini 3.5 Flash prediction integration
    if (isGeminiEnabledRef.current) {
      geminiActive = true;
      if (activeAnalysis && activeAnalysis.asset === sym && activeAnalysis.minute === currentMinute && activeAnalysis.gemini?.success) {
        const confVal = activeAnalysis.gemini.confidence ?? 0;
        if (confVal >= minConfluenceRef.current) {
          geminiSuccess = true;
          geminiBull = activeAnalysis.gemini.bullish;
          geminiConfidence = confVal;
          geminiReasoning = activeAnalysis.gemini.reasoning ?? undefined;

          if (geminiBull !== null) {
            scores.sigs.unshift({
              lbl: `I.A. (Gemini 3.5): ${geminiReasoning}`,
              sc: geminiBull ? 3 : -3,
              badge: geminiBull ? 'bul' : 'ber'
            });
          }
        } else {
          geminiSuccess = false;
          geminiReasoning = `Descartado: Confiança de IA de ${confVal}% menor que a confluência mínima de ${minConfluenceRef.current}%`;
        }
      }
    }

    // Evaluate previous prediction if one is registered and unresolved
    const latestClose = c1[c1.length - 1].c;
    
    setPredictionHistory((prevHistory) => {
      // Evaluate any pending predictions whose target candle is now fully loaded and closed in c1
      const updatedHistory = prevHistory.map((pendingPred) => {
        if (pendingPred.result !== null) return pendingPred;
        if (pendingPred.asset !== sym) return pendingPred;

        if (pendingPred.targetTs) {
          const latestCandle = c1[c1.length - 1];
          if (latestCandle && latestCandle.t > pendingPred.targetTs) {
            const matchCandle = c1.find((c) => c.t === pendingPred.targetTs);
            if (matchCandle) {
              const closedUp = matchCandle.c >= matchCandle.o;
              const correct = pendingPred.bull ? closedUp : !closedUp;
              return {
                ...pendingPred,
                result: correct,
                closePrice: matchCandle.c
              };
            }
          }
        } else {
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

      // Register the new active prediction strictly when the high-probability conflux satisfies all alignment bounds
      const confluencePercentage = scores.confluencePercentage ?? 0;
      const isConfluxMet = confluencePercentage >= minConfluenceRef.current;

      const techBullish = scores.tot > 0;
      const techBearish = scores.tot < 0;
      const hasTechDirection = techBullish || techBearish;
      const techBias = techBullish;

      const isMacroAligned = scores.mt ? (scores.mt.bull === techBias) : false;

      const activeAiBiases: boolean[] = [];
      if (deepseekActive && deepseekSuccess && deepseekBull !== null) {
        activeAiBiases.push(deepseekBull);
      }
      if (geminiActive && geminiSuccess && geminiBull !== null) {
        activeAiBiases.push(geminiBull);
      }

      const isAiAligned = (!deepseekActive && !geminiActive) || (activeAiBiases.length > 0 && activeAiBiases.every((aiBull) => aiBull === techBias));
      const isAllConditionsMet = isConfluxMet && hasTechDirection && isMacroAligned && isAiAligned;

      if (!isAllConditionsMet) {
        return updatedHistory;
      }

      // Check duplicate pending predictions
      const now = new Date();
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);
      const targetTs = Math.floor(targetDate.getTime() / 1000);
      
      const hasDuplicate = updatedHistory.some(p => p.asset === sym && p.targetTs === targetTs && p.result === null);
      if (hasDuplicate) {
        return updatedHistory;
      }

      const timeStr = targetDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const bullSemIa = techBias;
      const mathBullGeral = techBias;

      const newPrediction: PredictionRecord = {
        id: `${Date.now()}-${Math.random()}`,
        asset: sym,
        time: timeStr,
        ts: Math.floor(now.getTime() / 1000),
        targetTs: targetTs,
        cp: latestClose,
        bull: mathBullGeral,
        bullSemIa: bullSemIa,
        bullComIa: deepseekBull !== null ? deepseekBull : geminiBull,
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
        result: null,
      };

      return [...updatedHistory, newPrediction];
    });
  }, []);

  /**
   * Main synchronous cycle fetching candles for all selected active assets in parallel
   */
  const executeUpdateCycle = useCallback(async (
    forcedSymbols?: Array<keyof typeof ASSET_MAP>,
    forcedApi?: 'coders' | 'binance'
  ) => {
    const syms = forcedSymbols || selectedSymbolsRef.current;
    const api = forcedApi || selectedApiRef.current;
    if (syms.length === 0) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Execute fetches in parallel for all assets
      await Promise.all(syms.map(async (sym) => {
        try {
          const [m1Data, m2Data, m5Data, m15Data, h1Data] = await Promise.all([
            fetchCandles(1, 100, sym, api),
            fetchCandles(2, 30, sym, api),
            fetchCandles(5, 30, sym, api),
            fetchCandles(15, 30, sym, api),
            fetchCandles(60, 30, sym, api),
          ]);

          if (m1Data.length === 0) {
            throw new Error(`Não foi possível carregar os dados de candles M1 para ${sym}.`);
          }

          // Read previous close or fallback
          let prevClose = m1Data[m1Data.length - 1].o;
          setAssetsStates((prev) => {
            const oldState = prev[sym];
            if (oldState && oldState.candlesM1.length > 0) {
              prevClose = oldState.candlesM1[oldState.candlesM1.length - 1].c;
            }
            return prev;
          });

          const currentCandle = m1Data[m1Data.length - 1];
          const firstCandle = m1Data[0];
          const priceChange = currentCandle && firstCandle
            ? ((currentCandle.c - firstCandle.o) / firstCandle.o) * 100
            : 0;

          // Compute indicators and score
          const scores = score(m1Data, m2Data, m5Data);
          const confluxPercentage = scores.confluencePercentage ?? 0;
          const isConfluxMet = confluxPercentage >= minConfluenceRef.current;

          const activeAisAvailable = isDeepseekEnabledRef.current || isGeminiEnabledRef.current;

          let aiAnalysisResult: any = null;
          let aiStatusName: 'idle' | 'loading' | 'success' | 'error' | 'confluence_not_met' = 'idle';

          if (isConfluxMet && activeAisAvailable) {
            aiStatusName = 'loading';
            // Update ui temporarily to indicate loading
            setAssetsStates((prev) => ({
              ...prev,
              [sym]: {
                ...(prev[sym] || {}),
                candlesM1: m1Data,
                candlesM2: m2Data,
                candlesM5: m5Data,
                indicatorScores: scores,
                latestAiAnalysis: null,
                aiStatus: 'loading',
                prevClosePrice: prevClose,
                currentPriceValue: currentCandle.c,
                priceChangePercent: priceChange,
              }
            }));

            aiAnalysisResult = await executeAiAnalysis(sym, m1Data, m2Data, m5Data, m15Data || [], h1Data || []);
            aiStatusName = aiAnalysisResult ? 'success' : 'error';
          } else {
            aiStatusName = activeAisAvailable && !isConfluxMet ? 'confluence_not_met' : 'idle';
          }

          // Trigger prediction validation and consensus signals calculation
          handleTechnicalAnalysis(sym, m1Data, m2Data, m5Data, scores, aiAnalysisResult);

          setAssetsStates((prev) => ({
            ...prev,
            [sym]: {
              candlesM1: m1Data,
              candlesM2: m2Data,
              candlesM5: m5Data,
              indicatorScores: scores,
              latestAiAnalysis: aiAnalysisResult,
              aiStatus: aiStatusName,
              prevClosePrice: prevClose,
              currentPriceValue: currentCandle.c,
              priceChangePercent: priceChange,
            }
          }));

        } catch (err: any) {
          console.error(`Falha ao sincronizar dados de mercado do ativo ${sym}:`, err);
        }
      }));

    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Falha ao sincronizar dados com o servidor de trading.');
    } finally {
      setIsLoading(false);
    }
  }, [handleTechnicalAnalysis, executeAiAnalysis]);

  const handleToggleSymbol = useCallback((symbol: keyof typeof ASSET_MAP) => {
    setSelectedSymbols((prev) => {
      const isSelected = prev.includes(symbol);
      let updated: Array<keyof typeof ASSET_MAP>;
      if (isSelected) {
        if (prev.length <= 1) return prev; // keep at least 1
        updated = prev.filter((s) => s !== symbol);
      } else {
        updated = [...prev, symbol];
      }
      // Trigger execution cycle on updated list of symbols
      executeUpdateCycle(updated);
      return updated;
    });
  }, [executeUpdateCycle]);

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

    countdownIntervalRef.current = setInterval(() => {
      const now = new Date();
      const seconds = now.getSeconds();
      const currentMinute = now.getMinutes();

      // Countdown reports how many seconds until the next 52nd second
      const remainingSeconds = seconds < 52 ? 52 - seconds : 112 - seconds;
      setCountdown(remainingSeconds);

      // Trigger automatic update cycle strictly at 52s of the current minute
      if (seconds === 52 && lastSyncMinuteRef.current !== currentMinute) {
         lastSyncMinuteRef.current = currentMinute;
         executeUpdateCycle();
      }
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [executeUpdateCycle]);

  // Setup styling utilities
  const formatNumber = (num: number | null | undefined, decimals = 2) => {
    if (num === null || num === undefined) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

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
                Análise técnica dinâmica quantitativa operando em multi-candles M1 + M2 & M5
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
          <div className="bg-rose-955/40 border border-rose-500/20 text-rose-300 rounded-2xl p-4 flex gap-3 text-xs leading-relaxed" id="error-alert">
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

        {/* Assets Selector Block / Trading Pair Pills */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]" id="trading-pair-selection-container">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2 border-b border-zinc-900">
            <div className="flex items-center gap-2.5">
              <Coins className="w-5 h-5 text-indigo-400" />
              <div>
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold font-mono">Trading Pairs</span>
                <h2 className="text-sm text-zinc-100 font-medium font-sans mt-0.5">Selecione Múltiplos Ativos para Análise Simultânea</h2>
              </div>
            </div>

            {/* Realtime Search bar */}
            <div className="relative w-full lg:w-64">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Pesquisar ativo (ex: BTC)..."
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                className="w-full bg-zinc-900/60 border border-zinc-800/80 rounded-xl pl-9 pr-8 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 font-sans transition duration-200"
              />
              {assetSearch && (
                <button
                  onClick={() => setAssetSearch('')}
                  className="absolute right-2.5 top-1.5 text-zinc-500 hover:text-zinc-350 text-sm font-sans"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Category Tabs Switcher */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            <div className="flex bg-zinc-900/40 p-1 border border-zinc-900 rounded-xl space-x-1">
              {['Todos', 'Principais', 'Layer 1s', 'DeFi & Oráculos', 'Memecoins'].map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-[10.5px] font-medium transition duration-205 select-none hover:cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-zinc-800 text-zinc-100 shadow-sm font-bold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid Layout listing filtered assets */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {(() => {
              const keys = Object.keys(ASSET_MAP) as Array<keyof typeof ASSET_MAP>;
              const filteredKeys = keys.filter((sym) => {
                const assetMeta = ASSET_MAP[sym];
                
                // Category Filter
                if (selectedCategory !== 'Todos' && assetMeta.category !== selectedCategory) {
                  return false;
                }
                
                // Search Filter
                if (assetSearch.trim()) {
                  const query = assetSearch.toLowerCase();
                  const matchesSymbol = sym.toLowerCase().includes(query);
                  const matchesBinanceSym = assetMeta.binanceSym.toLowerCase().includes(query);
                  const matchesName = assetMeta.name.toLowerCase().includes(query);
                  return matchesSymbol || matchesBinanceSym || matchesName;
                }
                
                return true;
              });

              if (filteredKeys.length === 0) {
                return (
                  <div className="col-span-full py-8 text-center bg-zinc-900/10 border border-zinc-900/40 rounded-xl">
                    <p className="text-xs text-zinc-500 italic">
                      Nenhum trading pair encontrado para "<span>{assetSearch}</span>" na categoria selecionada.
                    </p>
                  </div>
                );
              }

              return filteredKeys.map((symbol) => {
                const active = selectedSymbols.includes(symbol);
                const assetMeta = ASSET_MAP[symbol];
                return (
                  <button
                    key={symbol}
                    onClick={() => handleToggleSymbol(symbol)}
                    className={`px-3.5 py-3 rounded-xl border text-left transition duration-200 flex flex-col justify-between hover:cursor-pointer relative group overflow-hidden ${
                      active
                        ? 'bg-gradient-to-br from-indigo-950/80 to-zinc-950/90 border-indigo-500/40 text-indigo-100 shadow-[0_4px_20px_rgba(99,102,241,0.15)] ring-1 ring-indigo-505/20'
                        : 'bg-zinc-900/40 border-zinc-850/80 text-zinc-400 hover:bg-zinc-900/80 hover:border-zinc-700/80 hover:text-zinc-200'
                    }`}
                  >
                    {/* Glowing ornament for active */}
                    {active && (
                      <span className="absolute top-0 right-0 w-8 h-8 bg-indigo-500/10 rounded-bl-full blur-sm" />
                    )}
                    
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono text-xs font-bold tracking-wider group-hover:text-zinc-100 transition duration-150">
                        {symbol}
                      </span>
                      <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded leading-none transition duration-150 ${
                        active 
                          ? 'bg-indigo-500/20 text-indigo-300' 
                          : 'bg-zinc-950/60 text-zinc-500 group-hover:text-zinc-400'
                      }`}>
                        {assetMeta.category}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between w-full">
                      <span className={`text-[10px] font-sans font-medium transition duration-150 truncate max-w-[110px] ${
                        active ? 'text-zinc-200 font-semibold' : 'text-zinc-500 group-hover:text-zinc-350'
                      }`}>
                        {assetMeta.name}
                      </span>
                      <span className="text-[8px] font-mono opacity-50 tracking-widest">{assetMeta.binanceSym}</span>
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>

        {/* Painel Unificado de Configurações Operacionais */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 shadow-[0_4px_25px_rgba(0,0,0,0.3)] grid grid-cols-1 md:grid-cols-2 gap-6" id="operational-settings-panel">
          
          {/* Configuração das IAs */}
          <div className="flex flex-col justify-between space-y-4">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold font-mono">Assistência de Inteligência Artificial</span>
              <h3 className="text-sm text-zinc-100 font-semibold font-sans mt-0.5">Selecione os Copilotos Ativos</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5 font-sans">Escolha as IAs que deseja ativar para predição.</p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {/* Deepseek Switch */}
              <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-850 px-3.5 py-2 rounded-xl">
                <span className="text-xs font-mono font-bold text-teal-400">DS V3</span>
                <button
                  id="deepseek-toggle-switch"
                  onClick={() => setIsDeepseekEnabled(!isDeepseekEnabled)}
                  className="hover:cursor-pointer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none bg-zinc-800"
                  style={{ backgroundColor: isDeepseekEnabled ? '#14b8a6' : '#27272a' }}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ${
                    isDeepseekEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {/* Gemini Switch */}
              <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-850 px-3.5 py-2 rounded-xl">
                <span className="text-xs font-mono font-bold text-indigo-400">GEMINI 3.5</span>
                <button
                  id="gemini-toggle-switch"
                  onClick={() => setIsGeminiEnabled(!isGeminiEnabled)}
                  className="hover:cursor-pointer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none bg-zinc-800"
                  style={{ backgroundColor: isGeminiEnabled ? '#6366f1' : '#27272a' }}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ${
                    isGeminiEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          </div>

          {/* Configuração da Confluência Mínima */}
          <div className="flex flex-col justify-between space-y-4 md:border-l md:border-zinc-900 md:pl-6">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold font-mono">Parâmetro de Decisão</span>
              <h3 className="text-sm text-zinc-100 font-semibold font-sans mt-0.5">Limite de Confluência Mínima</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5 font-sans">Porcentagem mínima de coerência técnica exigida.</p>
            </div>

            <div className="flex bg-zinc-900/60 p-1 border border-zinc-850 rounded-xl max-w-md">
              {[50, 60, 70, 80, 90, 100].map((val) => (
                <button
                  key={val}
                  onClick={() => setMinConfluence(val)}
                  className={`flex-1 text-center py-2 text-xs font-mono font-bold rounded-lg transition-all duration-205 leading-none hover:cursor-pointer ${
                    minConfluence === val 
                      ? 'bg-indigo-600 text-white shadow-md font-extrabold' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Gride de Dashboards para Múltiplos Ativos */}
        <div className="space-y-6" id="assets-dashboards-container">
          {selectedSymbols.map((sym) => {
            const state = assetsStates[sym];
            if (!state) {
              return (
                <div key={sym} className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 text-center text-zinc-400 flex flex-col items-center justify-center animate-pulse">
                  <RotateCw className="w-6 h-6 text-indigo-500 animate-spin mb-3" />
                  <span className="text-xs font-semibold font-sans">Carregando dados e análise quantitativa para {sym}...</span>
                </div>
              );
            }

            const { indicatorScores, currentPriceValue, priceChangePercent, prevClosePrice } = state;

            return (
              <div key={sym} className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 shadow-[0_12px_45px_rgba(0,0,0,0.6)] relative overflow-hidden" id={`consensus-dashboard-${sym}`}>
                <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center justify-between">
                  {/* Ativo Escolhido */}
                  <div className="flex flex-col space-y-2 border-b md:border-b-0 md:border-r border-zinc-900 pb-6 md:pb-0 md:pr-8">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase font-bold">Ativo Escolhido</span>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold font-mono text-lg shadow-[0_0_20px_rgba(99,102,241,0.1)]">
                        {sym.split('/')[0]}
                      </div>
                      <div>
                        <h3 className="text-2xl font-extrabold text-zinc-100 font-sans tracking-tight">{sym}</h3>
                        <p className="text-xs text-zinc-400 font-medium">{ASSET_MAP[sym]?.name}</p>
                      </div>
                    </div>
                    {currentPriceValue !== null && (
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className={`text-xl font-mono font-bold tracking-tight ${
                          prevClosePrice && currentPriceValue > prevClosePrice 
                            ? 'text-emerald-400 animate-pulse' 
                            : prevClosePrice && currentPriceValue < prevClosePrice 
                            ? 'text-rose-400 animate-pulse' 
                            : 'text-zinc-200'
                        }`}>
                          ${formatNumber(currentPriceValue, 2)}
                        </span>
                        <span className={`text-xs font-mono font-semibold ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Tendência */}
                  <div className="flex flex-col space-y-2 border-b md:border-b-0 md:border-r border-zinc-900 pb-6 md:pb-0 md:px-4">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase font-bold">Tendência Combinada</span>
                    <div className="flex items-center gap-3.5 mt-1.5">
                      {indicatorScores && indicatorScores.tot > 0 ? (
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                            <span className="text-xl font-bold">▲</span>
                          </div>
                          <div>
                            <span className="text-lg font-black tracking-wide text-emerald-400 uppercase font-sans">ALTA (COMPRA)</span>
                            <p className="text-[11px] text-zinc-400 mt-0.5">Pressão Compradora Dominante</p>
                          </div>
                        </div>
                      ) : indicatorScores && indicatorScores.tot < 0 ? (
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.15)]">
                            <span className="text-xl font-bold">▼</span>
                          </div>
                          <div>
                            <span className="text-lg font-black tracking-wide text-rose-400 uppercase font-sans">BAIXA (VENDA)</span>
                            <p className="text-[11px] text-zinc-400 mt-0.5">Pressão Vendedora Dominante</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-zinc-800/30 border border-zinc-800/60 flex items-center justify-center text-zinc-400">
                            <span className="text-xl font-bold">⬥</span>
                          </div>
                          <div>
                            <span className="text-lg font-black tracking-wide text-zinc-400 uppercase font-sans">NEUTRA</span>
                            <p className="text-[11px] text-zinc-400 mt-0.5">Forças em Perfeito Equilíbrio</p>
                          </div>
                        </div>
                      )}
                    </div>
                    {indicatorScores && (
                      <div className="mt-2 text-[11px] text-zinc-500">
                        Regime do Mercado: <strong className="text-zinc-400">{indicatorScores.regime}</strong>
                      </div>
                    )}
                  </div>

                  {/* Pontuação Geral (Consenso) */}
                  <div className="flex flex-col space-y-2 md:pl-8">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase font-bold">Pontuação Geral (Consenso)</span>
                    {indicatorScores && (
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className={`text-4xl font-extrabold tracking-tight font-mono ${
                          indicatorScores.tot > 0 ? 'text-emerald-400' : indicatorScores.tot < 0 ? 'text-rose-400' : 'text-zinc-300'
                        }`}>
                          {indicatorScores.tot > 0 ? '+' : ''}{indicatorScores.tot}
                        </span>
                        <span className="text-zinc-500 text-sm font-sans font-medium">pontos acumulados</span>
                      </div>
                    )}
                    
                    {/* Confluência bar */}
                    {indicatorScores && (
                      <div className="space-y-1 mt-2.5">
                        <div className="flex justify-between items-center text-[10.5px] font-mono">
                          <span className="text-zinc-500">Confluência Técnica:</span>
                          <span className={`font-bold ${indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence ? 'text-emerald-400' : 'text-indigo-400'}`}>
                            {indicatorScores.confluenceScore}/10 ({indicatorScores.confluencePercentage}%)
                          </span>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 h-2 rounded-full overflow-hidden relative">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${
                              indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence ? 'bg-emerald-500' : 'bg-indigo-500'
                            }`} 
                            style={{ width: `${indicatorScores.confluencePercentage}%` }}
                          />
                        </div>
                        <span className="text-[9.5px] text-zinc-500 block font-sans">
                          Operação {indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence ? '✓ Autorizada para Próxima Vela' : '✕ Suspensa por falta de Confluência'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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

