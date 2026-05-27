/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { IndicatorScores } from '../types';
import { ArrowUpRight, ArrowDownRight, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';

interface PredictionBoxProps {
  scores: IndicatorScores | null;
  macroTimeframe?: number;
}

export const PredictionBox: React.FC<PredictionBoxProps> = ({ scores, macroTimeframe = 5 }) => {
  if (!scores) {
    return (
      <div className="bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl p-8 text-center" id="prediction-empty">
        <HelpCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2 animate-pulse" />
        <p className="text-zinc-400 text-sm font-sans">
          Aguardando análise técnica inicial para gerar a próxima previsão de trading...
        </p>
      </div>
    );
  }

  const { tot, conf, dots, pat, mt } = scores;
  const isBull = tot >= 0;

  // Setup contextual style constants based on bullish/bearish forecasting direction
  const boxBgClass = isBull 
    ? 'bg-emerald-950/45 border-emerald-500/30 text-emerald-100 hover:border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.05)]' 
    : 'bg-rose-950/45 border-rose-500/30 text-rose-100 hover:border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.05)]';

  const titleText = isBull ? 'Próxima vela: alta esperada (COMPRA/LONG)' : 'Próxima vela: baixa esperada (VENDA/SHORT)';
  const subtitleText = isBull ? 'Pressão compradora dominante a curto prazo' : 'Pressão vendedora dominante a curto prazo';

  const mLabel = `M${macroTimeframe}`;
  const macroAligns = mt ? mt.bull === isBull : false;

  return (
    <div className={`border rounded-2xl p-5 md:p-6 transition duration-300 ${boxBgClass}`} id="prediction-result-panel">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Signal Title & Trend Indicator */}
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl flex items-center justify-center shrink-0 ${isBull ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
            {isBull ? (
              <ArrowUpRight className="w-8 h-8" />
            ) : (
              <ArrowDownRight className="w-8 h-8" />
            )}
          </div>
          <div>
            <h3 className="text-lg md:text-xl font-bold tracking-tight font-sans">
              {titleText}
            </h3>
            <p className={`text-xs md:text-sm mt-0.5 opacity-80 font-sans`}>
              {subtitleText}
            </p>
            <div className="flex items-center gap-2 mt-2 font-mono text-xs">
              <span className="text-zinc-400">Confiança: </span>
              <span className={`font-semibold uppercase tracking-wider ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                {conf}
              </span>
              <span className="tracking-widest text-[11px] text-zinc-300 font-sans">
                {dots}
              </span>
            </div>
          </div>
        </div>

        {/* Quantitative Score Metrics Badge */}
        <div className="text-left md:text-right md:border-l md:border-zinc-800/80 md:pl-6 shrink-0 flex md:flex-col justify-between items-center md:items-end gap-3 md:gap-0">
          <div>
            <span className={`text-3xl md:text-4xl font-extrabold font-mono tracking-tighter ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
              {tot > 0 ? `+${tot}` : tot}
            </span>
            <div className="text-[10px] text-zinc-400 uppercase tracking-widest font-sans font-medium mt-1">
              Score Técnico Total
            </div>
          </div>
        </div>
      </div>

      {/* Auxiliary Warning/Alert Subsections */}
      {(mt || pat) && (
        <div className="mt-5 pt-4 border-t border-zinc-800/60 space-y-3 font-sans text-xs">
          {/* Multi-Timeframe Alignment Verification */}
          {mt && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${macroAligns ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
              {macroAligns ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span className="font-sans leading-tight">
                <strong>Confirmação {mLabel}:</strong> Tendência macro de {mt.bull ? 'Alta' : 'Baixa'} (Score {mt.sc}/5) — {macroAligns ? `Alinhamento forte com a previsão M1!` : `⚠️ Conflito moderado entre tempo gráfico curto M1 e médio ${mLabel}.`}
              </span>
            </div>
          )}

          {/* Candlestick Pattern Detail Card */}
          {pat && (
            <div className="text-zinc-300 leading-relaxed bg-zinc-900/65 px-3 py-2.5 rounded-lg border border-zinc-800/80">
              <span className="font-semibold text-zinc-100 flex items-center gap-1.5 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${pat.s > 0 ? 'bg-emerald-500' : pat.s < 0 ? 'bg-rose-500' : 'bg-zinc-400'}`} />
                Padrão Relevante Ativo: {pat.n}
              </span>
              <span>{pat.d}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
