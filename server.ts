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
 * Calls Gemini with automatic retry and model fallback to handle transient 503/429 errors.
 */
async function callGeminiWithRetry(ai: any, prompt: string, retries = 2, delay = 1000) {
  let lastError: any = null;
  const modelsToTry = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  
  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        console.log(`Calling Gemini API using model ${modelName} (attempt ${attempt + 1}/${retries + 1})...`);
        const response = await ai.models.generateContent({
          model: modelName,
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
        
        return response;
      } catch (err: any) {
        lastError = err;
        const msg = err.message || String(err);
        const msgLower = msg.toLowerCase();
        console.warn(`Attempt ${attempt + 1} failed for ${modelName}:`, msg);
        
        // 503 Service Unavailable, 429 Rate Limit/Quota Exceeded, high demand issues are transient
        const isTransient = msgLower.includes('503') || 
                            msgLower.includes('unavailable') || 
                            msgLower.includes('high demand') ||
                            msgLower.includes('resource_exhausted') ||
                            msgLower.includes('429') ||
                            msgLower.includes('overloaded');
                            
        if (!isTransient || attempt === retries) {
          break; // break loop to try next model or throw last error
        }
        
        // Wait before next attempt with progressive backoff
        await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
  }
  
  throw lastError;
}

// ==========================================
// HOMEBROKER PROXY INTEGRATION & ENGINES
// ==========================================

let homeBrokerToken: string | null = null;
let homeBrokerTokenExpiry = 0; // ms epoch timestamp

function formatHomeBrokerDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

async function getHomeBrokerToken(): Promise<string> {
  const now = Date.now();
  if (homeBrokerToken && now < homeBrokerTokenExpiry - 120000) {
    return homeBrokerToken;
  }

  logInfo('Logging into HomeBroker API for a new session...');
  try {
    const response = await fetch('https://account-manager-api.homebroker.com/v2/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.homebroker.com',
        'Referer': 'https://www.homebroker.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        username: 'daniel@frsoares.com',
        password: 'Fe@25110709h',
        role: 'hbb',
        session_id: '18c13ee06c2a11f193349b5eb733afc3',
        platform: 'web',
        properties: {}
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Login failed with status ${response.status}: ${errText}`);
    }

    const data: any = await response.json();
    if (!data.accessToken) {
      throw new Error('Access token was not provided by HomeBroker authentication gateway.');
    }

    homeBrokerToken = data.accessToken;
    homeBrokerTokenExpiry = Date.now() + 3600 * 1000; // expires in 1 hour
    logInfo('Successfully acquired new HomeBroker Bearer Token.');
    return homeBrokerToken;
  } catch (err: any) {
    logInfo(`FAILED TO RE-AUTHENTICATE WITH HOMEBROKER API: ${err.message}`);
    throw err;
  }
}

/**
 * Proxy to fetch list of assets dynamically from HomeBroker configuration endpoint
 */
app.get('/api/homebroker/assets', async (req, res) => {
  try {
    const token = await getHomeBrokerToken();
    logInfo('Fetching config/assets from HomeBroker API...');
    const response = await fetch('https://user-api.homebroker.com/config/assets', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://www.homebroker.com',
        'Referer': 'https://www.homebroker.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `HomeBroker API error: ${errText}` });
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      const activeAssets = data.filter((item: any) => item.is_active === true && item.is_closed === false);
      return res.json(activeAssets);
    }
    return res.json(data);
  } catch (err: any) {
    console.error('HomeBroker assets proxy encountered issues:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Proxy to fetch candlestick historical values from HomeBroker market API
 */
app.get('/api/homebroker/candles', async (req, res) => {
  const { symbol, resolution, countback } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query parameter: symbol' });
  }

  const resNum = parseInt(resolution as string) || 1;
  const countNum = parseInt(countback as string) || 100;

  try {
    const token = await getHomeBrokerToken();
    const endDate = new Date();
    // Provide a small buffer margin factor (e.g. 1.8x) to ensure enough candles are present
    const startDate = new Date(endDate.getTime() - (countNum * resNum * 1.8) * 60 * 1000);

    const startStr = formatHomeBrokerDate(startDate);
    const endStr = formatHomeBrokerDate(endDate);

    // If resolution of candle being loaded is M2, we fetch M1 from API and downsample
    const fetchRes = resNum === 2 ? 1 : resNum;

    const url = `https://market-historic-api.homebroker.com/assets/read_values?symbol=${symbol}&start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&timespan=minutes&multiple=${fetchRes}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://www.homebroker.com',
        'Referer': 'https://www.homebroker.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `HomeBroker history API error: ${errText}` });
    }

    const data: any = await response.json();
    const values = data.values || [];

    // Map response value bars to standard Candle interface, explicitly bypassing "volume" and "count" (as requested)
    let candles: any[] = values.map((item: any) => ({
      t: Math.floor(new Date(item.time_stamp).getTime() / 1000),
      o: Number(item.open),
      h: Number(item.high),
      l: Number(item.low),
      c: Number(item.close),
      v: 0 // Explicitly set volume to 0 as it is inconsistent/fake in HomeBroker
    }));

    // Chronological order
    candles.sort((a, b) => a.t - b.t);

    if (resNum === 2) {
      // Custom server-side synthetic M2 candle merger
      const aggregated: any[] = [];
      const groups: { [key: number]: any[] } = {};

      for (const c of candles) {
        const bucket = Math.floor(c.t / 120) * 120;
        if (!groups[bucket]) {
          groups[bucket] = [];
        }
        groups[bucket].push(c);
      }

      const buckets = Object.keys(groups).map(Number).sort((a, b) => a - b);
      for (const bucket of buckets) {
        const list = groups[bucket];
        list.sort((a, b) => a.t - b.t);
        const o = list[0].o;
        const c = list[list.length - 1].c;
        const h = Math.max(...list.map(x => x.h));
        const l = Math.min(...list.map(x => x.l));
        aggregated.push({
          t: bucket,
          o,
          h,
          l,
          c,
          v: 0
        });
      }
      candles = aggregated;
    }

    return res.json(candles.slice(-countNum));
  } catch (err: any) {
    console.error(`HomeBroker candle query error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * endpoint for Deepseek AI Analysis
 */
app.post('/api/analyze-deepseek', async (req, res) => {
  const { symbol, m1, m5, m15, h1, resolution, technicalMetric } = req.body;

  if (!symbol || !m1 || !m5) {
    return res.status(400).json({ error: 'Missing physical parameters.' });
  }

  const macroRes = resolution || 5;
  const metrics = technicalMetric || {};

  // Pick last 10 1m candles and last 5 candles for other timeframes
  const recentM1 = m1.slice(-10);
  const recentM5 = m5.slice(-5);
  const recentM15 = m15 ? m15.slice(-5) : [];
  const recentH1 = h1 ? h1.slice(-5) : [];

  const prompt = `Você é um robô quantitativo profissional de trading de alta precisão e Inteligência Artificial para Opções Binárias de curtíssimo prazo (expiração para o próximo candle de 1 minuto M1).
Sua meta é avaliar com máxima assertividade se a PRÓXIMA vela (candle) M1 do ativo ${symbol} fechará em Alta (ALTA/VERDE/BULLISH) ou em Baixa (BAIXA/VERMELHO/BEARISH) em relação ao seu preço de abertura atual de $${m1[m1.length-1]?.c || 'N/A'}.

Para tomar essa decisão de altíssima precisão técnica, analise as seguintes frentes combinadas de acordo com as diretrizes do Smart Money Concepts (SMC) e Fluxo Profissional:

1. PRICE ACTION & ANATOMIA DE CANDLES (M1):
- Últimos 10 candles de M1 para verificar comportamento de corpos, pavios e sombras:
${JSON.stringify(recentM1.map((c: any) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })), null, 2)}
Observe rejeições extremas de preço (sombras longas, martelos, estrelas cadentes, pin bars), velas de grande força direcional sem pavios (Marubozu) ou candles sem corpo indicando exaustão total do movimento (Doji).

2. DINÂMICA MACRO E ANÁLISE MULTITEMPORAL DE 4 TIMEFRAMES:
- Tendência na escala M${macroRes}:
${JSON.stringify(recentM5.map((c: any) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })), null, 2)}
- Contexto na escala Intermediária M15:
${recentM15.length > 0 ? JSON.stringify(recentM15.map((c: any) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })), null, 2) : 'Aguardando sincronização de M15...'}
- Estrutura de Longo Prazo H1:
${recentH1.length > 0 ? JSON.stringify(recentH1.map((c: any) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })), null, 2) : 'Aguardando sincronização de H1...'}

Identifique se a micro-tendência de M1 está alinhada ou se movendo contra a tendência macro de M${macroRes}, M15 ou H1 (confluência de tempos maiores).

3. ZONAS DE CONTEXTO E FLUXO (Volume Profile, VWAP, CVD, S/R):
- Suporte Dinâmico M1 (Mínima de 20 períodos): $${metrics.supportM1 || 'N/A'}
- Resistência Dinâmica M1 (Máxima de 20 períodos): $${metrics.resistanceM1 || 'N/A'}
- Perfil de Volume Visible Range (VPVR): Ponto de Controle (POC) de Liquidez em $${metrics.pocPrice || 'N/A'}
- Referência de VWAP Bandeira 1: [Banda Inferior: $${metrics.vwapLower1 || 'N/A'} | Banda Superior: $${metrics.vwapUpper1 || 'N/A'}] (VWAP Base: $${metrics.vwapBase || 'N/A'})
- Referência de VWAP Bandeira 2: [Banda Inferior: $${metrics.vwapLower2 || 'N/A'} | Banda Superior: $${metrics.vwapUpper2 || 'N/A'}]
- CVD (Cumulative Volume Delta): Último delta simulated: ${metrics.cvdLastDelta || 'N/A'} (Fator Desequilíbrio de Fluxo: ${metrics.cvdImbalance || 'Normal'})
- Estrutura de Mercado: CHoCH Detectado? ${metrics.chochDetected ? `SIM (${metrics.chochType} em $${metrics.chochPrice})` : 'NÃO'} | BOS (Break of Structure)? ${metrics.bosDetected ? `SIM (${metrics.bosType} em $${metrics.bosPrice})` : 'NÃO'}

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
        console.log('Using robust Gemini API with automatic retry and model fallback...');
        const response = await callGeminiWithRetry(ai, prompt);
 
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
        console.error('Gemini execution error:', gemIniErr.message || gemIniErr);
        let errorMsg = gemIniErr.message || String(gemIniErr);
        try {
          // If the message is a string carrying a JSON block, parse it
          const jsonStart = errorMsg.indexOf('{');
          const jsonEnd = errorMsg.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            const rawJson = errorMsg.slice(jsonStart, jsonEnd + 1);
            const parsed = JSON.parse(rawJson);
            if (parsed?.error?.message) {
              errorMsg = parsed.error.message;
            } else if (parsed?.message) {
              errorMsg = parsed.message;
            }
          }
        } catch (e) {
          // Fall back to original error message
        }
 
        // Keep it super clean and friendly if rate limited/quota exceeded/down
        if (errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('exceeded')) {
          errorMsg = 'Limite de cota excedido (429 - RESOURCE_EXHAUSTED). Limite da versão gratuita atingido para este minuto ou dia.';
        } else if (errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('temporary') || errorMsg.includes('high demand') || errorMsg.includes('overloaded')) {
          errorMsg = 'O serviço da IA do Gemini está temporariamente indisponível ou congestionado no momento (Erro 503). Por favor, tente novamente em instantes.';
        }
 
        return { success: false, error: errorMsg };
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
