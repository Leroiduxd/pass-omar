// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: false
}));
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));

app.use('/api', require('./routes/write'));
app.use('/api', require('./routes/read'));
+ app.use('/api', require('./routes/generate')); // <-- nouvelle route

// middleware d'erreur global (si tu l'avais déjà, garde-le)
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload trop volumineux (max 50MB).' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

const PORT = process.env.PORT || 9999;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
