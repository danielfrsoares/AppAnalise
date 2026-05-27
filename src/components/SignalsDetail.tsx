/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SignalDetail } from '../types';
import { Eye, ChevronRight } from 'lucide-react';

interface SignalsDetailProps {
  signals: SignalDetail[];
}

export const SignalsDetail: React.FC<SignalsDetailProps> = ({ signals }) => {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden" id="signals-detail-panel">
      {/* Header bar */}
      <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-xs text-zinc-200 uppercase tracking-wider font-sans">
            Detalhamento dos Sinais de Indicadores
          </span>
        </div>
        <span className="text-[11px] font-mono text-zinc-500 bg-zinc-950 px-2.5 py-0.5 rounded-full border border-zinc-800/80">
          {signals.length} Variáveis Analisadas
        </span>
      </div>

      {/* Signals Body List */}
      <div className="p-4 space-y-1.5" id="signals-list">
        {signals.length === 0 ? (
          <div className="text-center py-6 text-zinc-500 text-xs font-sans">
            Nenhum sinal técnico disponível no momento.
          </div>
        ) : (
          signals.map((sig, idx) => {
            const isBull = sig.badge === 'bul';
            const isBear = sig.badge === 'ber';

            const badgeStyle = isBull
              ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/20'
              : isBear
              ? 'bg-rose-950/40 text-rose-400 border border-rose-500/20'
              : 'bg-zinc-900 text-zinc-400 border border-zinc-800';

            const scoreSign = sig.sc > 0 ? `+${sig.sc}` : `${sig.sc}`;

            return (
              <div 
                key={idx}
                className="flex items-center justify-between border-b border-zinc-900/60 py-2.5 last:border-b-0 hover:bg-zinc-900/20 px-2 rounded-lg transition"
              >
                {/* Left side label with bullet dot */}
                <div className="flex items-center gap-2 text-xs md:text-sm text-zinc-300 font-sans max-w-[80%] pr-4">
                  <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${isBull ? 'text-emerald-500' : isBear ? 'text-rose-500' : 'text-zinc-600'}`} />
                  <span className="leading-relaxed leading-6">{sig.lbl}</span>
                </div>

                {/* Weighted Scoring Badge */}
                <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md tracking-tight shrink-0 ${badgeStyle}`}>
                  {scoreSign}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
