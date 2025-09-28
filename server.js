// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Autoriser les origines (pendant le dev : tout ; ensuite, restreins à ton domaine)
app.use(cors({
  origin: (origin, cb) => cb(null, true), // autorise toutes origines, y compris 'null' (file://)
  credentials: false
}));

// Gérer la pré-requête OPTIONS pour toutes les routes
app.options('*', cors());

// Accepter gros JSON (jusqu'à 50 Mo)
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api', require('./routes/write')); // POST /api/courses
app.use('/api', require('./routes/read'));  // GET  /api/ues, /api/ues/:ueNumber/courses, /api/courses/:id

// Middleware d'erreur global -> répond TOUJOURS en JSON
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
