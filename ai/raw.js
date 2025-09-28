// ai/raw.js
const { chat } = require('./nscale');

async function run() {
  const messages = [
    { role: 'user', content: 'Hello, how are you?' }
  ];

  const { content } = await chat(messages, {
    temperature: 0.3,
    max_tokens: 200
  });

  console.log('=== Nscale raw response ===\n', content);
}

run().catch(err => {
  console.error('Raw call failed:', err);
  process.exit(1);
});
