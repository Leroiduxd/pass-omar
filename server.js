// server.js
const express = require('express');
const app = express();

app.use(express.json());

// routes séparées : write (POST) et read (GET)
app.use('/api', require('./routes/write'));
app.use('/api', require('./routes/read'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
