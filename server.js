// server.js
require('dotenv').config();
const express = require('express');

const app = express();

// Autoriser les payloads JSON volumineux (ex: longs cours)
app.use(express.json({ limit: '10mb' }));

// Endpoints (écriture et lecture)
app.use('/api', require('./routes/write')); // POST /api/courses
app.use('/api', require('./routes/read'));  // GET  /api/ues, /api/ues/:ueNumber/courses, /api/courses/:id

// Démarrage
const PORT = process.env.PORT || 9999;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
