// ai/raw.js
const { chat } = require('./nscale');

async function run() {
  const messages = [
    { role: 'system', content: 'Provide a summary of the blog post in 100 words.' },
    { role: 'user', content: 'Serverless inference simplifies access to AI models...' }
  ];

  const { content } = await chat(messages, {
    // model: 'meta-llama/Llama-3.1-8B-Instruct', // optionnel si défini dans .env
    temperature: 0.3,
    max_tokens: 400
  });

  console.log('=== Nscale raw response ===\n', content);
}

run().catch(err => {
  console.error('Raw call failed:', err);
  process.exit(1);
});
