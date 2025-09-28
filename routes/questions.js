// routes/questions.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

/**
 * GET /api/questions?set_code=...
 * -> renvoie toutes les questions d'un lot (triées par question_index)
 */
router.get('/questions', async (req, res) => {
  try {
    const set_code = String(req.query.set_code || '').trim();
    if (!set_code) {
      return res.status(400).json({ error: 'Paramètre set_code requis.' });
    }

    const { data, error } = await supabase
      .from('questions')
      .select('id, set_code, question_index, question, options, answer, explanation, created_at')
      .eq('set_code', set_code)
      .order('question_index', { ascending: true });

    if (error) {
      console.error('GET /questions error:', error);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }

    res.json({ questions: data || [] });
  } catch (err) {
    console.error('GET /questions exception:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/questions/:id
 * -> renvoie une question précise
 */
router.get('/questions/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id requis.' });

    const { data, error } = await supabase
      .from('questions')
      .select('id, set_code, question_index, question, options, answer, explanation, created_at')
      .eq('id', id)
      .single();

    if (error?.code === 'PGRST116') {
      return res.status(404).json({ error: 'Question introuvable.' });
    }
    if (error) {
      console.error('GET /questions/:id error:', error);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }

    res.json(data);
  } catch (err) {
    console.error('GET /questions/:id exception:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
