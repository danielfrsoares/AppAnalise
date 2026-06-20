/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Candle, IndicatorScores, PredictionRecord } from './types';
import { fetchCandles, ASSET_MAP, DEFAULT_HOMEBROKER_ASSETS } from './utils/api';
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
  Server,
  Activity,
  User,
} from 'lucide-react';

export default function App() {
  const [selectedBroker, setSelectedBroker] = useState<'binance' | 'homebroker' | null>(null);
  
  // Main states including the selected symbols for multi-asset
  const [selectedSymbols, setSelectedSymbols] = useState<Array<string>>([]);
  const [selectedApi] = useState<'coders' | 'binance'>('binance');
  
  // HomeBroker dynamic assets list
  const [homeBrokerAssets, setHomeBrokerAssets] = useState<Record<string, { symbol: string; name: string; category: string; isActive?: boolean; basePayout?: number; icon?: string }>>(DEFAULT_HOMEBROKER_ASSETS);

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
  const [isDeepseekEnabled, setIsDeepseekEnabled] = useState(false);
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(false);

  // Sync references to bypass stale closures in heartbeats/timers
  const isDeepseekEnabledRef = useRef(isDeepseekEnabled);
  const isGeminiEnabledRef = useRef(isGeminiEnabled);
  const selectedSymbolsRef = useRef(selectedSymbols);
  const selectedApiRef = useRef(selectedApi);
  const minConfluenceRef = useRef(minConfluence);
  const selectedBrokerRef = useRef(selectedBroker);

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

  useEffect(() => {
    selectedBrokerRef.current = selectedBroker;
  }, [selectedBroker]);

  // Interval reference trackers
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Dynamic assets mapping depending on current broker selection
  const currentAssets = selectedBroker === 'homebroker' ? homeBrokerAssets : ASSET_MAP;

  /**
   * Triggers the AI analytic model evaluation for a specific asset with shared cached candle datasets
   */
  const executeAiAnalysis = useCallback(async (
    sym: string,
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
    sym: string,
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
    forcedSymbols?: Array<string>,
    forcedApi?: 'coders' | 'binance',
    forcedBroker?: 'binance' | 'homebroker'
  ) => {
    const broker = forcedBroker || selectedBrokerRef.current;
    if (!broker) return; // Wait for user to select a broker!

    const syms = forcedSymbols || selectedSymbolsRef.current;
    if (syms.length === 0) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Execute fetches in parallel for all assets
      await Promise.all(syms.map(async (sym) => {
        try {
          const [m1Data, m2Data, m5Data, m15Data, h1Data] = await Promise.all([
            fetchCandles(1, 100, sym, broker),
            fetchCandles(2, 30, sym, broker),
            fetchCandles(5, 30, sym, broker),
            fetchCandles(15, 30, sym, broker),
            fetchCandles(60, 30, sym, broker),
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

  const handleToggleSymbol = useCallback((symbol: string) => {
    setSelectedSymbols((prev) => {
      const isSelected = prev.includes(symbol);
      let updated: Array<string>;
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

  // Load HomeBroker assets dynamically when active
  useEffect(() => {
    if (selectedBroker === 'homebroker') {
      fetch('/api/homebroker/assets')
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('HomeBroker config API failed');
        })
        .then((data) => {
          if (Array.isArray(data)) {
            const mapped: Record<string, any> = {};
            data.filter((item: any) => item.is_active === true && item.is_closed === false).forEach((item: any) => {
              mapped[item.symbol] = {
                symbol: item.symbol,
                name: item.name || item.symbol,
                category: item.market_name === 'stocks' ? 'Mercado de Ações (OTC)' : 'Criptoativos',
                basePayout: item.base_payout,
                isActive: true,
                isClosed: item.is_closed
              };
            });
            setHomeBrokerAssets(mapped);
          }
        })
        .catch((err) => {
          console.warn('Failed to load live HomeBroker configuration, using high-fidelity defaults:', err);
        });
    }
  }, [selectedBroker]);

  // Load initial dataset on mount (returns early if selectedBroker is null, as expected)
  useEffect(() => {
    if (selectedBroker) {
      executeUpdateCycle();
    }
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
            
            {/* Broker Changer dropdown */}
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-850 px-2.5 py-1 rounded-lg text-xs">
              <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider font-sans">Broker:</span>
              <select
                value={selectedBroker || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    setSelectedBroker(null);
                    setSelectedSymbols([]);
                  } else {
                    const newBroker = val as 'binance' | 'homebroker';
                    setSelectedBroker(newBroker);
                    const initSyms = newBroker === 'binance' ? ['BTC/USD'] : ['BTC-USD-OTC'];
                    setSelectedSymbols(initSyms);
                    setTimeout(() => executeUpdateCycle(initSyms, selectedApi, newBroker), 50);
                  }
                }}
                className="bg-zinc-950 font-bold border border-zinc-800 rounded-md px-2 py-0.5 text-[11px] text-zinc-100 outline-none focus:border-indigo-500 hover:cursor-pointer"
              >
                <option value="">-- Nenhum --</option>
                <option value="binance">Binance Spot</option>
                <option value="homebroker">HomeBroker OTC</option>
              </select>
            </div>

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
        
        {/* If no broker is selected, show centered welcome picker */}
        {!selectedBroker ? (
          <div className="max-w-2xl mx-auto py-12 px-4" id="broker-selection-welcome">
            <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 space-y-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden text-center">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Server className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold uppercase tracking-wide text-zinc-100 font-sans">
                    CONECTAR AO BROKER DE MERCADO
                  </h2>
                  <p className="text-xs text-zinc-400 mt-2 max-w-md mx-auto font-sans leading-relaxed">
                    Para iniciar as análises técnicas de curtíssimo prazo e previsões automatizadas com inteligência artificial, escolha sua fonte de feeds de dados para continuar.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                {/* Binance Card */}
                <button
                  onClick={() => {
                    setSelectedBroker('binance');
                    const initSyms = ['BTC/USD'];
                    setSelectedSymbols(initSyms);
                    setTimeout(() => executeUpdateCycle(initSyms, selectedApi, 'binance'), 50);
                  }}
                  className="bg-zinc-900/40 border border-zinc-800/85 hover:border-amber-500/45 hover:bg-zinc-900 rounded-2xl p-6 text-left transition duration-300 hover:cursor-pointer flex flex-col justify-between h-48 relative group overflow-hidden shadow-sm"
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-amber-400 font-extrabold text-xs tracking-wider uppercase font-mono">Binance Spot</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200 group-hover:text-amber-400 transition mb-1 font-sans">Criptomoedas</h4>
                    <p className="text-[11px] text-zinc-500 leading-snug font-sans">
                      Conexão em tempo real de ativos digitais suportados diretamente da API Spot pública da Binance (BTC, ETH, etc.).
                    </p>
                  </div>
                </button>

                {/* HomeBroker Card */}
                <button
                  onClick={() => {
                    setSelectedBroker('homebroker');
                    const initSyms = ['BTC-USD-OTC'];
                    setSelectedSymbols(initSyms);
                    setTimeout(() => executeUpdateCycle(initSyms, selectedApi, 'homebroker'), 50);
                  }}
                  className="bg-zinc-900/40 border border-zinc-800/85 hover:border-indigo-500/45 hover:bg-zinc-900 rounded-2xl p-6 text-left transition duration-300 hover:cursor-pointer flex flex-col justify-between h-48 relative group overflow-hidden shadow-sm"
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-indigo-400 font-extrabold text-xs tracking-wider uppercase font-mono">HomeBroker OTC</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200 group-hover:text-indigo-400 transition mb-1 font-sans">Ações & Cripto OTC</h4>
                    <p className="text-[11px] text-zinc-500 leading-snug font-sans">
                      Conecte-se com o feed OTC privado de ações do mercado americano (NVIDIA, Google, etc) e dados customizados.
                    </p>
                  </div>
                </button>
              </div>

              <div className="border-t border-zinc-900 pt-5 flex items-center justify-center gap-1.5 text-[10px] text-zinc-500 font-mono">
                <Activity className="w-3.5 h-3.5 text-zinc-500" />
                <span>Nenhum broker ativo · Aguardando definição do usuário</span>
              </div>
            </div>
          </div>
        ) : (
          <>
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
              {(selectedBroker === 'homebroker' 
                ? ['Todos', 'Mercado de Ações (OTC)', 'Criptoativos', 'Câmbio / Forex']
                : ['Todos', 'Principais', 'Layer 1s', 'DeFi & Oráculos', 'Memecoins']
              ).map((cat) => {
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
              const keys = Object.keys(currentAssets);
              const filteredKeys = keys.filter((sym) => {
                const assetMeta = currentAssets[sym];
                if (!assetMeta) return false;
                
                // Category Filter
                if (selectedCategory !== 'Todos' && assetMeta.category !== selectedCategory) {
                  return false;
                }
                
                // Search Filter
                if (assetSearch.trim()) {
                  const query = assetSearch.toLowerCase();
                  const matchesSymbol = sym.toLowerCase().includes(query);
                  const matchesBinanceSym = assetMeta.binanceSym ? assetMeta.binanceSym.toLowerCase().includes(query) : false;
                  const matchesName = assetMeta.name ? assetMeta.name.toLowerCase().includes(query) : false;
                  return matchesSymbol || matchesBinanceSym || matchesName;
                }
                
                return true;
              });

              if (filteredKeys.length === 0) {
                return (
                  <div className="col-span-full py-8 text-center bg-zinc-900/10 border border-zinc-900/40 rounded-xl">
                    <p className="text-xs text-zinc-500 italic">
                      Nenhum ativo encontrado para "<span>{assetSearch}</span>" na categoria selecionada.
                    </p>
                  </div>
                );
              }

              return filteredKeys.map((symbol) => {
                const active = selectedSymbols.includes(symbol);
                const assetMeta = currentAssets[symbol];
                if (!assetMeta) return null;
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
                      {selectedBroker === 'binance' && (
                        <span className="text-[8px] font-mono opacity-50 tracking-widest">{assetMeta.binanceSym}</span>
                      )}
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

        {/* Painel de Ativos Escolhidos em Formato de Tabela Simplificada */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]" id="assets-dashboards-container">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-900 bg-zinc-900/20 text-zinc-400 font-mono text-[9px] uppercase tracking-wider">
                  <th className="py-3 px-5">Ativo</th>
                  <th className="py-3 px-5">Preço Atual</th>
                  <th className="py-3 px-5 text-center">Tendência Combinada</th>
                  <th className="py-3 px-5 text-center">Regime</th>
                  <th className="py-3 px-5 text-center">Pontuação</th>
                  <th className="py-3 px-5">Confluência</th>
                  <th className="py-3 px-5 text-right">Operação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {selectedSymbols.map((sym) => {
                  const state = assetsStates[sym];
                  if (!state) {
                    return (
                      <tr key={sym} className="animate-pulse hover:bg-zinc-900/10 transition-colors">
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded bg-zinc-900 border border-zinc-850 flex items-center justify-center">
                              <RotateCw className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                            </div>
                            <div>
                              <span className="font-extrabold text-zinc-400 text-xs font-mono">{sym}</span>
                              <span className="text-[10px] text-zinc-500 block">Carregando análise...</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-5 text-zinc-600 font-mono text-xs">-</td>
                        <td className="py-4 px-5 text-center text-zinc-600 font-sans text-xs">-</td>
                        <td className="py-4 px-5 text-center text-zinc-600 font-sans text-xs">-</td>
                        <td className="py-4 px-5 text-center text-zinc-600 font-mono text-xs">-</td>
                        <td className="py-4 px-5 text-zinc-600 font-mono text-xs">-</td>
                        <td className="py-4 px-5 text-right text-zinc-600 font-mono text-xs">-</td>
                      </tr>
                    );
                  }

                  const { indicatorScores, currentPriceValue, priceChangePercent, prevClosePrice } = state;

                  return (
                    <tr key={sym} className="hover:bg-zinc-900/20 transition-colors" id={`consensus-dashboard-${sym}`}>
                      {/* Ativo */}
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold font-mono text-xs shadow-sm">
                            {sym.split('/')[0]}
                          </div>
                          <div className="min-w-0">
                            <span className="font-extrabold text-zinc-200 text-xs font-sans tracking-tight block">{sym}</span>
                            <span className="text-[10px] text-zinc-500 block truncate max-w-[120px]">{currentAssets[sym]?.name || '-'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Preço Atual */}
                      <td className="py-3 px-5">
                        {currentPriceValue !== null ? (
                          <div className="flex flex-col">
                            <span className={`text-xs font-mono font-bold tracking-tight ${
                              prevClosePrice && currentPriceValue > prevClosePrice 
                                ? 'text-emerald-400' 
                                : prevClosePrice && currentPriceValue < prevClosePrice 
                                ? 'text-rose-400' 
                                : 'text-zinc-200'
                            }`}>
                              ${formatNumber(currentPriceValue, 2)}
                            </span>
                            <span className={`text-[9.5px] font-mono font-semibold leading-none mt-0.5 ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {priceChangePercent >= 0 ? '▲' : '▼'}{Math.abs(priceChangePercent).toFixed(2)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-650 font-mono">-</span>
                        )}
                      </td>

                      {/* Tendência Combinada */}
                      <td className="py-3 px-5 text-center">
                        {indicatorScores && indicatorScores.tot > 0 ? (
                          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/15 text-emerald-400">
                            <span className="text-[9px] font-bold">▲</span>
                            <span className="text-[9px] font-extrabold tracking-wide uppercase font-sans">COMPRA</span>
                          </div>
                        ) : indicatorScores && indicatorScores.tot < 0 ? (
                          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/15 text-rose-400">
                            <span className="text-[9px] font-bold">▼</span>
                            <span className="text-[9px] font-extrabold tracking-wide uppercase font-sans">VENDA</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-zinc-800/20 border border-zinc-800/40 text-zinc-400">
                            <span className="text-[9px] font-bold">⬥</span>
                            <span className="text-[9px] font-extrabold tracking-wide uppercase font-sans">NEUTRA</span>
                          </div>
                        )}
                      </td>

                      {/* Regime */}
                      <td className="py-3 px-5 text-center">
                        <span className="text-xs font-medium text-zinc-405 font-sans">
                          {indicatorScores ? indicatorScores.regime : '-'}
                        </span>
                      </td>

                      {/* Pontuação */}
                      <td className="py-3 px-5 text-center">
                        {indicatorScores && (
                          <span className={`text-xs font-black font-mono ${
                            indicatorScores.tot > 0 ? 'text-emerald-400' : indicatorScores.tot < 0 ? 'text-rose-400' : 'text-zinc-300'
                          }`}>
                            {indicatorScores.tot > 0 ? '+' : ''}{indicatorScores.tot} pts
                          </span>
                        )}
                      </td>

                      {/* Confluência */}
                      <td className="py-3 px-5 font-sans">
                        {indicatorScores ? (
                          <div className="flex flex-col w-28">
                            <div className="flex justify-between items-center text-[10px] font-mono leading-none mb-1">
                              <span className={`font-bold text-[9.5px] ${indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence ? 'text-emerald-400' : 'text-indigo-400'}`}>
                                {indicatorScores.confluenceScore}/10 ({indicatorScores.confluencePercentage}%)
                              </span>
                            </div>
                            <div className="bg-zinc-900 border border-zinc-850 h-1 rounded-full overflow-hidden relative">
                              <div 
                                className={`h-full rounded-full transition-all duration-300 ${
                                  indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence ? 'bg-emerald-500' : 'bg-indigo-500'
                                }`} 
                                style={{ width: `${indicatorScores.confluencePercentage}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-650 font-mono">-</span>
                        )}
                      </td>

                      {/* Operação */}
                      <td className="py-3 px-5 text-right">
                        {indicatorScores ? (
                          <span className={`text-[9.5px] font-sans font-bold px-2 py-0.5 rounded ${
                            indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence
                              ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/15'
                              : 'text-zinc-500 bg-zinc-900 border border-zinc-850'
                          }`}>
                            {indicatorScores.confluencePercentage && indicatorScores.confluencePercentage >= minConfluence
                              ? '✓ Autorizada'
                              : '✕ Suspensa'}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-650 font-mono">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. FOOTER: SYSTEM ACCURACY LOGS TABLE CARD */}
        <PredictionHistory history={predictionHistory} />

          </>
        )}

        {/* Disclaimer footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-zinc-500 border-t border-zinc-900/80 pt-6 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Integridade Matemática Garantida por {selectedBroker === 'homebroker' ? 'HomeBroker API Client' : 'Binance Spot API Failover'}</span>
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

