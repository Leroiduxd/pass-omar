// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Autoriser CORS (toutes origines pour le MVP)
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: false
}));
app.options('*', cors());

// Accepter des JSON volumineux
app.use(express.json({ limit: '50mb' }));

// Routes API
app.use('/api', require('./routes/write'));
app.use('/api', require('./routes/read'));
app.use('/api', require('./routes/generate'));
app.use('/api', require('./routes/questions'));
app.use('/api', require('./routes/answer'));
app.use('/api', require('./routes/score'));
app.use('/api', require('./routes/open'));
app.use('/api', require('./routes/refine'));
app.use('/api', require('./routes/sets'));
app.use('/api', require('./routes/multi'));


// Middleware d'erreur global
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload trop volumineux (max 50MB).' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

// Démarrage serveur
const PORT = process.env.PORT || 9999;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
