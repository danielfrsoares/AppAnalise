/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

// Configure simple file logger to diagnose startup inside sandbox
const LOG_FILE = path.join(process.cwd(), 'server.log');
function logInfo(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    // Ignore log failures
  }
}

// Clear old logs on boot
try {
  fs.writeFileSync(LOG_FILE, `=== SERVER START ===\n`);
} catch (e) {}

// Load environment variables
dotenv.config();

logInfo('Initializing Express app');
const app = express();
const PORT = 3000;

app.use(express.json({ limit: '5mb' }));

// Middleware to log all incoming requests
app.use((req, res, next) => {
  logInfo(`INCOMING REQUEST: ${req.method} ${req.url}`);
  next();
});

// Initialize Gemini if key exists
const geminiApiKey = process.env.GEMINI_API_KEY;
const ai = geminiApiKey 
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    })
  : null;

/**
 * Helper to clean and parse JSON from LLM responses (handling codeblocks)
 */
function parseJSONResponse(text: string) {
  try {
    // Normal direct parse
    return JSON.parse(text);
  } catch (e) {
    // Remove markdown codeblock qualifiers
    const cleaned = text
      .replace(/```json/i, '')
      .replace(/```/g, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error('Failed to parse AI response as JSON:', text);
      throw new Error('AI response format was invalid.');
    }
  }
}

/**
 * endpoint for Deepseek AI Analysis
 */
app.post('/api/analyze-deepseek', async (req, res) => {
  const { symbol, m1, m5, resolution, technicalMetric } = req.body;

  if (!symbol || !m1 || !m5) {
    return res.status(400).json({ error: 'Missing physical parameters.' });
  }

  const macroRes = resolution || 5;
  const metrics = technicalMetric || {};

  // Pick last 10 1m candles and last 5 macro candles to avoid hitting context token ceilings and maintain extreme low-latency
  const recentM1 = m1.slice(-10);
  const recentM5 = m5.slice(-5);

  const prompt = `Você é um robô quantitativo profissional de trading de alta precisão e Inteligência Artificial para Opções Binárias de curtíssimo prazo (expiração para o próximo candle de 1 minuto M1).
Sua meta é avaliar com máxima assertividade se a PRÓXIMA vela (candle) M1 do ativo ${symbol} fechará em Alta (ALTA/VERDE/BULLISH) ou em Baixa (BAIXA/VERMELHO/BEARISH) em relação ao seu preço de abertura atual de $${m1[m1.length-1]?.c || 'N/A'}.

Para tomar essa decisão de altíssima precisão técnica, analise as seguintes frentes combinadas:

1. PRICE ACTION & ANATOMIA DE CANDLES (M1):
- Últimos 10 candles de M1 para verificar comportamento de corpos, pavios e sombras:
${JSON.stringify(recentM1.map((c: any) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })), null, 2)}
Observe rejeições extremas de preço (sombras longas, martelos, estrelas cadentes, pin bars), velas de grande força direcional sem pavios (Marubozu) ou candles sem corpo indicando exaustão total do movimento (Doji).

2. DINÂMICA MACRO E ANÁLISE MULTITEMPORAL:
- Tendência na escala macro M${macroRes} (Tendência secundária de suporte):
${JSON.stringify(recentM5.map((c: any) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })), null, 2)}
Identifique se a micro-tendência de M1 está alinhada ou se movendo contra a tendência macro de M${macroRes}.

3. ZONAS DE CONTEXTO (SUPORTE E RESISTÊNCIA DE M1):
- Suporte Dinâmico M1 (Mínima de 20 períodos): $${metrics.supportM1 || 'Calculando'}
- Resistência Dinâmica M1 (Máxima de 20 períodos): $${metrics.resistanceM1 || 'Calculando'}
Avalie se o preço atual está testando essas zonas. Um toque no suporte com rejeição inferior favorece compras; um toque na resistência com rejeição superior favorece vendas.

4. SINAIS TÉCNICOS SINTETIZADOS DA TELA (RSI, Bollinger, MACD, Volume, EMAs, Estocástico):
${metrics.signals ? metrics.signals.map((s: string) => `- ${s}`).join('\n') : '- Dados de indicadores calculados pendentes'}
- Padrão de Vela Identificado via Código: ${metrics.pattern || 'Nenhum'}
- Volatilidade Relativa do ATR: ${metrics.volatilityAtrPercent ? metrics.volatilityAtrPercent.toFixed(4) + '%' : 'Calculando'}
- Classificação do Mercado: ${metrics.operabilityState || 'Calculando'} (${metrics.operabilityLabel || ''} - ${metrics.operabilitySuitability || ''})

5. REGRAS PARA OPÇÕES BINÁRIAS (EXPIRAÇÃO EM 1 MINUTO):
- O preço de opções binárias é extremamente sensível a ruídos. Se a volatilidade for EXTREMA ou BAIXA de forma travada, exija confirmações robustas de múltiplos indicadores.
- Priorize confluências (ex: Preço estendido tocando Banda de Bollinger Superior + RSI Sobrecomprado em M1 + Padrão Estrela Cadente/Pin Bar + Macrosegmento M${macroRes} em baixa).

Sua tarefa: Retorne um objeto JSON exatamente no seguinte formato:
{
  "bullish": true (para compra) ou false (para venda),
  "confidence": um número de confiança de 0 a 100 baseado na solidez das confluências encontradas,
  "reasoning": "Uma explicação direta, profissional e estritamente analítica de apenas 1 frase curta em português."
}`;

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const isDsConfigured = !!(deepseekApiKey && deepseekApiKey !== 'YOUR_DEEPSEEK_KEY' && deepseekApiKey.trim() !== '');
  const isGemConfigured = !!ai;

  const runDs = isDsConfigured;
  const runGem = isGemConfigured;

  const tasks: Promise<any>[] = [];

  // Deepseek Task
  if (runDs) {
    tasks.push((async () => {
      try {
        console.log('Sending transaction and candles to Deepseek API...');
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${deepseekApiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: 'You are a professional financial trading assistant that outputs strictly in JSON.' },
              { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices[0].message.content;
          const result = parseJSONResponse(content);
          return {
            success: true,
            bullish: result.bullish,
            confidence: result.confidence,
            reasoning: result.reasoning
          };
        } else {
          const errText = await response.text();
          console.warn('Deepseek responded with error status:', response.status, errText);
          return { success: false, error: `Status ${response.status}: ${errText.slice(0, 100)}` };
        }
      } catch (err: any) {
        console.error('Deepseek fetch encountered issues:', err.message);
        return { success: false, error: err.message };
      }
    })());
  } else {
    tasks.push(Promise.resolve({ success: false, error: 'Deepseek not configured or disabled' }));
  }

  // Gemini Task
  if (runGem) {
    tasks.push((async () => {
      try {
        console.log('Using robust Gemini API for technical analysis...');
        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                bullish: {
                  type: Type.BOOLEAN,
                  description: 'Whether the prediction is bullish (true) or bearish (false).'
                },
                confidence: {
                  type: Type.INTEGER,
                  description: 'Integer from 0 to 100.'
                },
                reasoning: {
                  type: Type.STRING,
                  description: 'Short single sentence reasoning in Portuguese.'
                }
              },
              required: ['bullish', 'confidence', 'reasoning']
            }
          }
        });

        const text = response.text;
        if (text) {
          const result = parseJSONResponse(text);
          return {
            success: true,
            bullish: result.bullish,
            confidence: result.confidence,
            reasoning: result.reasoning
          };
        }
        return { success: false, error: 'No response text returned.' };
      } catch (gemIniErr: any) {
        console.error('Gemini execution error:', gemIniErr.message);
        return { success: false, error: gemIniErr.message };
      }
    })());
  } else {
    tasks.push(Promise.resolve({ success: false, error: 'Gemini not configured or disabled' }));
  }

  const [dsResult, gemResult] = await Promise.all(tasks);

  return res.json({
    success: true,
    deepseek: dsResult,
    gemini: gemResult
  });
});

async function startServer() {
  try {
    logInfo('Starting server and configuring Vite middleware/routes...');
    // Vite dev server mounting or production serving
    if (process.env.NODE_ENV !== 'production') {
      logInfo('Creating Vite dev server in middleware mode...');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      logInfo('Vite dev server middleware mounted successfully.');
    } else {
      logInfo('Serving production build files...');
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req: any, res: any) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    app.listen(PORT, '0.0.0.0', () => {
      logInfo(`Express container server actively listening on port ${PORT}`);
    });
  } catch (error: any) {
    logInfo(`FATAL ERROR DURING STARTUP: ${error.message}\n${error.stack}`);
  }
}

startServer();
