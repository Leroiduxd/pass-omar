// ai/nscale.js
require('dotenv').config();

const NSCALE_URL = 'https://inference.api.nscale.com/v1/chat/completions';
const NSCALE_TOKEN = process.env.NSCALE_SERVICE_TOKEN;
// Par défaut tu peux choisir le modèle via .env, sinon exemple Llama 3.1 8B Instruct
const DEFAULT_MODEL = process.env.NSCALE_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

if (!NSCALE_TOKEN) {
  throw new Error('❌ NSCALE_SERVICE_TOKEN manquant dans .env');
}

// messages = [{role:'system'|'user'|'assistant', content:'...'}, ...]
async function chat(messages, opts = {}) {
  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 2000,
  };

  const r = await fetch(NSCALE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NSCALE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Nscale error ${r.status}: ${text}`);
  }

  const data = await r.json();
  // OpenAI-compatible: data.choices[0].message.content
  const content = data?.choices?.[0]?.message?.content ?? '';
  return { content, raw: data };
}

module.exports = { chat };
