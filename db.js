// db.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("❌ SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant dans .env");
}

// Client backend (privilégié) — n'expose jamais cette clé côté navigateur
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = { supabase };
