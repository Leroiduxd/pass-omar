// routes/score.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

/**
 * GET /api/score?set_code=...&user_id=...
 * - Retourne { total, correct, percent }
 */
router.get('/score', async (req, res) => {
  try {
    const set_code = String(req.query.set_code || '');
    const user_id = String(req.query.user_id || '');

    if (!set_code || !user_id) {
      return res.status(400).json({ error: 'set_code et user_id requis.' });
    }

    const { data, error } = await supabase
      .from('attempts')
      .select('is_correct')
      .eq('set_code', set_code)
      .eq('user_id', user_id);

    if (error) {
      console.error('Fetch attempts error:', error);
      return res.status(500).json({ error: 'Erreur lecture tentatives.' });
    }

    const total = (data || []).length;
    const correct = (data || []).filter(a => a.is_correct).length;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    res.json({ total, correct, percent });
  } catch (err) {
    console.error('GET /score error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
