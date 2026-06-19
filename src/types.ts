/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Candle {
  t: number; // Unix timestamp in seconds
  o: number; // Open price
  h: number; // High price
  l: number; // Low price
  c: number; // Close price
  v: number; // Volume
}

export interface PatternResult {
  n: string; // Pattern name (e.g. Doji, Martelo, Engolfo)
  s: number; // Score associated
  d: string; // Description of the pattern significance
}

export interface MtfResult {
  sc: number; // Score (out of 5)
  bull: boolean; // Is bullish consensus met?
}

export interface SignalDetail {
  lbl: string; // Detailed human-readable label
  sc: number;  // Numeric score weight (+/-)
  badge: 'bul' | 'ber' | 'neu'; // Visual badge style assignment
}

export interface IndicatorScores {
  tot: number;
  sigs: SignalDetail[];
  conf: 'muito fraco' | 'fraco' | 'moderado' | 'razoável' | 'forte';
  dots: string;
  pat: PatternResult | null;
  mt: MtfResult | null;
  regime?: string;
  confluenceScore?: number;
  confluencePercentage?: number;
  factors?: { name: string; score: number; bias: 'Alta' | 'Baixa' | 'Neutro'; aligned: boolean }[];
  marketRegimeState?: 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'NOISE';
}

export interface PredictionRecord {
  id: string; // Unique simulation/run id
  time: string; // Hour:Minutes formatted
  ts: number;   // Timestamp of the latest candle evaluated
  targetTs?: number; // Target timestamp we are predicting
  cp: number;   // Price when prediction was logged
  bull: boolean; // predicted move direction is buy/long -> GENERAL combined prediction
  bullSemIa: boolean; // predicted move direction WITHOUT AI (pure indicators)
  bullComIa: boolean | null; // Keep for legacy compatibility if needed
  aiReasoning?: string; // Keep for legacy
  aiConfidence?: number; // Keep for legacy
  aiEngine?: string; // Keep for legacy
  
  // Dual AI detailed predictions configuration
  deepseekActive?: boolean;
  deepseekSuccess?: boolean;
  deepseekBull?: boolean | null;
  deepseekConfidence?: number;
  deepseekReasoning?: string;

  geminiActive?: boolean;
  geminiSuccess?: boolean;
  geminiBull?: boolean | null;
  geminiConfidence?: number;
  geminiReasoning?: string;

  asset?: string; // Symbol identifier for the predicted asset (e.g., BTC/USD)

  tot: number;   // associated indicator final score (without AI bias)
  result: boolean | null; // true: success, false: failure, null: pending/waiting next price
}

export interface SelectedAsset {
  symbol: string;
  name: string;
  description: string;
}
