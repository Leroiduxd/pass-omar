// ai/nscale.js
require('dotenv').config();

const NSCALE_URL = 'https://inference.api.nscale.com/v1/chat/completions';
const NSCALE_TOKEN = process.env.NSCALE_SERVICE_TOKEN;

// 👉 modèle par défaut forcé
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

if (!NSCALE_TOKEN) {
  throw new Error('❌ NSCALE_SERVICE_TOKEN manquant dans .env');
}

// messages = [{role:'system'|'user'|'assistant', content:'...'}, ...]
async function chat(messages, opts = {}) {
  const body = {
    model: DEFAULT_MODEL, // toujours 20B
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
  const content = data?.choices?.[0]?.message?.content ?? '';
  return { content, raw: data };
}

module.exports = { chat };

