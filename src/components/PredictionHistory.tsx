/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PredictionRecord } from '../types';
import { Trophy, History, ShieldEllipsis, Check, X } from 'lucide-react';

interface PredictionHistoryProps {
  history: PredictionRecord[];
}

export const PredictionHistory: React.FC<PredictionHistoryProps> = ({ history }) => {
  // Compute accuracy statistics
  const completedPredictions = history.filter((p) => p.result !== null);
  const correctPredictions = completedPredictions.filter((p) => p.result === true);
  const accuracyPercent = completedPredictions.length > 0 
    ? Math.round((correctPredictions.length / completedPredictions.length) * 100)
    : null;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden" id="prediction-history-panel">
      {/* Header bar tracking score outcomes */}
      <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-orange-400" />
          <span className="font-semibold text-xs text-zinc-200 uppercase tracking-wider font-sans">
            Histórico de Previsões (Sessão Ativa)
          </span>
        </div>
        
        {accuracyPercent !== null ? (
          <div className="flex items-center gap-1.5 bg-emerald-950/50 border border-emerald-500/20 px-3 py-1 rounded-full text-xs text-emerald-400 font-mono font-bold self-start sm:self-auto">
            <Trophy className="w-3.5 h-3.5 text-emerald-400" />
            Acurácia: {accuracyPercent}% ({correctPredictions.length}/{completedPredictions.length})
          </div>
        ) : (
          <div className="flex items-center gap-1 bg-zinc-900 px-3 py-1 rounded-full text-xs text-zinc-400 font-sans border border-zinc-800/80 self-start sm:self-auto">
            <ShieldEllipsis className="w-3.5 h-3.5 text-zinc-500" />
            Calculando acurácia...
          </div>
        )}
      </div>

      {/* Grid Table Container */}
      <div className="p-4 overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Table Head Column Guide */}
          <div className="grid grid-cols-7 gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-bold border-b border-zinc-900 pb-2 mb-2 font-mono">
            <span>Horário</span>
            <span className="text-zinc-400">Ativo</span>
            <span className="text-indigo-400">Geral (Consenso)</span>
            <span>Anal. Técnica</span>
            <span>Deepseek V3</span>
            <span>Gemini 3.5</span>
            <span className="text-right">Resultado</span>
          </div>

          {/* Dynamic Records List */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1" id="history-items-list">
            {history.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs font-sans">
                Nenhuma previsão registrada nesta sessão ainda. Elas serão registradas a cada atualização do candlestick.
              </div>
            ) : (
              [...history]
                .reverse() // Display most recent predictions on top
                .map((rec) => {
                  const bullGeral = rec.bull;
                  // Fallback support for older schema predictions
                  const bullSemIa = rec.bullSemIa !== undefined ? rec.bullSemIa : rec.bull;
                  
                  let resultValueNode = null;
                  if (rec.result === null) {
                    resultValueNode = (
                      <span className="text-zinc-500 text-[10px] tracking-wide uppercase italic">
                        Pendente
                      </span>
                    );
                  } else if (rec.result === true) {
                    resultValueNode = (
                      <span className="text-emerald-400 font-bold flex items-center justify-end gap-1 text-[11px] bg-emerald-950/20 border border-emerald-500/10 px-2 py-0.5 rounded-lg">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ACERTO
                      </span>
                    );
                  } else {
                    resultValueNode = (
                      <span className="text-rose-400 font-bold flex items-center justify-end gap-1 text-[11px] bg-rose-950/20 border border-rose-500/10 px-2 py-0.5 rounded-lg">
                        <X className="w-3.5 h-3.5 text-rose-400" />
                        ERRO
                      </span>
                    );
                  }

                  return (
                    <div 
                      key={rec.id}
                      className="flex flex-col border-b border-zinc-900/80 last:border-b-0 py-2.5"
                    >
                      <div className="grid grid-cols-7 gap-2 px-1 items-center text-xs font-mono select-none">
                        {/* Time cell */}
                        <span className="text-zinc-400">{rec.time}</span>
                        
                        {/* Asset name cell */}
                        <span className="text-zinc-300 font-bold">{rec.asset || 'BTC/USD'}</span>
                        
                        {/* Prediction Geral Badge cell */}
                        <div>
                          {bullGeral ? (
                            <span className="bg-indigo-950/65 text-indigo-300 border border-indigo-500/40 px-2.5 py-1 rounded text-[10px] font-bold shadow-[0_0_12px_rgba(99,102,241,0.15)] inline-block">
                              ▲ ALTA
                            </span>
                          ) : (
                            <span className="bg-rose-950/50 text-rose-300 border border-rose-500/30 px-2.5 py-1 rounded text-[10px] font-bold inline-block">
                              ▼ BAIXA
                            </span>
                          )}
                        </div>

                        {/* Análise Técnica (Sem IA) */}
                        <div>
                          {bullSemIa ? (
                            <span className="text-emerald-400 font-bold text-[11px]">
                              ALTA ({rec.tot >= 0 ? `+${rec.tot}` : rec.tot})
                            </span>
                          ) : (
                            <span className="text-rose-400 font-bold text-[11px]">
                              BAIXA ({rec.tot})
                            </span>
                          )}
                        </div>

                        {/* Deepseek V3 Column */}
                        <div>
                          {rec.deepseekActive === false ? (
                            <span className="text-zinc-600 text-[10.5px] italic">Inativa</span>
                          ) : rec.deepseekSuccess === false ? (
                            <span className="text-rose-500 text-[10.5px] font-semibold uppercase" title={rec.deepseekReasoning}>Falhou</span>
                          ) : rec.deepseekBull === null ? (
                            <span className="text-zinc-500 text-[10.5px] italic">Sem sinal</span>
                          ) : rec.deepseekBull ? (
                            <span className="text-teal-400 font-bold text-[10.5px] bg-teal-950/40 border border-teal-500/25 px-2 py-0.5 rounded" title={rec.deepseekReasoning}>
                              ALTA {rec.deepseekConfidence ? `(${rec.deepseekConfidence}%)` : ''}
                            </span>
                          ) : (
                            <span className="text-pink-400 font-bold text-[10.5px] bg-pink-950/40 border border-pink-500/25 px-2 py-0.5 rounded" title={rec.deepseekReasoning}>
                              BAIXA {rec.deepseekConfidence ? `(${rec.deepseekConfidence}%)` : ''}
                            </span>
                          )}
                        </div>

                        {/* Gemini 3.5 Column */}
                        <div>
                          {rec.geminiActive === false ? (
                            <span className="text-zinc-600 text-[10.5px] italic">Inativa</span>
                          ) : rec.geminiSuccess === false ? (
                            <span className="text-rose-500 text-[10.5px] font-semibold uppercase" title={rec.geminiReasoning}>Falhou</span>
                          ) : rec.geminiBull === null ? (
                            <span className="text-zinc-500 text-[10.5px] italic">Sem sinal</span>
                          ) : rec.geminiBull ? (
                            <span className="text-indigo-400 font-bold text-[10.5px] bg-indigo-950/40 border border-indigo-500/25 px-2 py-0.5 rounded" title={rec.geminiReasoning}>
                              ALTA {rec.geminiConfidence ? `(${rec.geminiConfidence}%)` : ''}
                            </span>
                          ) : (
                            <span className="text-pink-400 font-bold text-[10.5px] bg-pink-950/40 border border-pink-500/25 px-2 py-0.5 rounded" title={rec.geminiReasoning}>
                              BAIXA {rec.geminiConfidence ? `(${rec.geminiConfidence}%)` : ''}
                            </span>
                          )}
                        </div>
                        
                        {/* Execution Outcome status cell */}
                        <div className="text-right flex justify-end font-sans">{resultValueNode}</div>
                      </div>

                      {/* Deepseek Reasoning details drop */}
                      {rec.deepseekActive && rec.deepseekSuccess && rec.deepseekReasoning && (
                        <div className="mt-1.5 ml-1 px-3 py-1 bg-zinc-900/30 border-l border-teal-500/30 rounded-r text-[10.5px] text-zinc-400 italic font-sans flex flex-col md:flex-row md:items-center gap-1.5">
                          <span className="text-teal-400 font-medium font-mono text-[9px] uppercase tracking-wider shrink-0 bg-teal-950/20 px-1 py-0.5 rounded">
                            Razão Deepseek:
                          </span>
                          <span>"{rec.deepseekReasoning}"</span>
                        </div>
                      )}

                      {/* Gemini Reasoning details drop */}
                      {rec.geminiActive && rec.geminiSuccess && rec.geminiReasoning && (
                        <div className="mt-1.5 ml-1 px-3 py-1 bg-zinc-900/30 border-l border-indigo-500/30 rounded-r text-[10.5px] text-zinc-400 italic font-sans flex flex-col md:flex-row md:items-center gap-1.5">
                          <span className="text-indigo-400 font-medium font-mono text-[9px] uppercase tracking-wider shrink-0 bg-indigo-950/20 px-1 py-0.5 rounded">
                            Razão Gemini:
                          </span>
                          <span>"{rec.geminiReasoning}"</span>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
