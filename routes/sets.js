// routes/sets.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

/**
 * GET /api/course/:courseId/sets
 * -> Liste tous les sets liés à un cours (QCM + OPEN), dédupliqués par set_code.
 *    Renvoie: { sets: [{ type, set_code, count, first_created_at, last_created_at }] }
 */
router.get('/course/:courseId/sets', async (req, res) => {
  try {
    const { courseId } = req.params;

    // QCM pour le cours
    const { data: mcqRaw, error: mcqErr } = await supabase
      .from('questions')
      .select('set_code, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true });
    if (mcqErr) {
      console.error('MCQ fetch error:', mcqErr);
      return res.status(500).json({ error: 'Erreur lecture QCM.' });
    }

    // OPEN pour le cours
    const { data: openRaw, error: openErr } = await supabase
      .from('open_questions')
      .select('set_code, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true });
    if (openErr) {
      console.error('OPEN fetch error:', openErr);
      return res.status(500).json({ error: 'Erreur lecture questions ouvertes.' });
    }

    // Agréger par set_code pour chaque type
    const groupBySet = (rows) => {
      const map = new Map();
      for (const r of rows || []) {
        const sc = r.set_code;
        const t = map.get(sc) || { set_code: sc, count: 0, first_created_at: r.created_at, last_created_at: r.created_at };
        t.count += 1;
        if (r.created_at < t.first_created_at) t.first_created_at = r.created_at;
        if (r.created_at > t.last_created_at) t.last_created_at = r.created_at;
        map.set(sc, t);
      }
      return Array.from(map.values());
    };

    const mcqGrouped = groupBySet(mcqRaw).map(x => ({ type: 'mcq', ...x }));
    const openGrouped = groupBySet(openRaw).map(x => ({ type: 'open', ...x }));

    // On renvoie les deux (non fusionnés entre eux pour garder le type explicite)
    const sets = [...mcqGrouped, ...openGrouped]
      .sort((a, b) => (new Date(b.last_created_at)) - (new Date(a.last_created_at)));

    res.json({ sets });
  } catch (err) {
    console.error('GET /course/:courseId/sets error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/set/mcq/:set_code
 * -> Récupère toutes les questions QCM d’un set (triées par question_index).
 *    Renvoie: { questions: [...] }
 */
router.get('/set/mcq/:set_code', async (req, res) => {
  try {
    const set_code = String(req.params.set_code || '').trim();
    if (!set_code) return res.status(400).json({ error: 'set_code requis.' });

    const { data, error } = await supabase
      .from('questions')
      .select('id, set_code, course_id, question_index, question, options, answer, explanation, difficulty, created_at')
      .eq('set_code', set_code)
      .order('question_index', { ascending: true });

    if (error) {
      console.error('GET /set/mcq/:set_code error:', error);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }

    res.json({ questions: data || [] });
  } catch (err) {
    console.error('GET /set/mcq/:set_code exception:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/set/open/:set_code
 * -> Récupère toutes les questions OUVERTES d’un set (triées par question_index).
 *    Renvoie: { questions: [...] }
 */
router.get('/set/open/:set_code', async (req, res) => {
  try {
    const set_code = String(req.params.set_code || '').trim();
    if (!set_code) return res.status(400).json({ error: 'set_code requis.' });

    const { data, error } = await supabase
      .from('open_questions')
      .select('id, set_code, course_id, question_index, prompt, reference_answer, difficulty, created_at')
      .eq('set_code', set_code)
      .order('question_index', { ascending: true });

    if (error) {
      console.error('GET /set/open/:set_code error:', error);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }

    res.json({ questions: data || [] });
  } catch (err) {
    console.error('GET /set/open/:set_code exception:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
