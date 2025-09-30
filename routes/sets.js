// routes/sets.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

/**
 * GET /api/course/:courseId/sets
 * -> Liste tous les sets liés à un cours (MCQ + OPEN + MULTI), dédupliqués par set_code.
 *    Renvoie: { sets: [{ type, set_code, count, first_created_at, last_created_at }] }
 */
router.get('/course/:courseId/sets', async (req, res) => {
  try {
    const { courseId } = req.params;

    // Récupération brute pour chaque type
    const [mcqRaw, openRaw, multiRaw] = await Promise.all([
      supabase.from('questions')
        .select('set_code, created_at')
        .eq('course_id', courseId)
        .order('created_at', { ascending: true }),
      supabase.from('open_questions')
        .select('set_code, created_at')
        .eq('course_id', courseId)
        .order('created_at', { ascending: true }),
      supabase.from('ms_questions')
        .select('set_code, created_at')
        .eq('course_id', courseId)
        .order('created_at', { ascending: true }),
    ]);

    if (mcqRaw.error)  { console.error('MCQ fetch error:', mcqRaw.error);   return res.status(500).json({ error: 'Erreur lecture QCM.' }); }
    if (openRaw.error) { console.error('OPEN fetch error:', openRaw.error); return res.status(500).json({ error: 'Erreur lecture questions ouvertes.' }); }
    if (multiRaw.error){ console.error('MULTI fetch error:', multiRaw.error);return res.status(500).json({ error: 'Erreur lecture multi.' }); }

    const groupBySet = (rows) => {
      const map = new Map();
      for (const r of rows || []) {
        const sc = r.set_code;
        const t  = r.created_at;
        const acc = map.get(sc) || { set_code: sc, count: 0, first_created_at: t, last_created_at: t };
        acc.count += 1;
        if (t < acc.first_created_at) acc.first_created_at = t;
        if (t > acc.last_created_at)  acc.last_created_at  = t;
        map.set(sc, acc);
      }
      return Array.from(map.values());
    };

    const mcqGrouped   = groupBySet(mcqRaw.data).map(x => ({ type: 'mcq',   ...x }));
    const openGrouped  = groupBySet(openRaw.data).map(x => ({ type: 'open',  ...x }));
    const multiGrouped = groupBySet(multiRaw.data).map(x => ({ type: 'multi', ...x }));

    const sets = [...mcqGrouped, ...openGrouped, ...multiGrouped]
      .sort((a, b) => new Date(b.last_created_at) - new Date(a.last_created_at));

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

/**
 * GET /api/set/multi/:set_code
 * -> Récupère toutes les questions MULTI d’un set (triées par question_index).
 *    Renvoie: { questions: [...] }
 */
router.get('/set/multi/:set_code', async (req, res) => {
  try {
    const set_code = String(req.params.set_code || '').trim();
    if (!set_code) return res.status(400).json({ error: 'set_code requis.' });

    const { data, error } = await supabase
      .from('ms_questions')
      .select('id, set_code, course_id, question_index, stem, propositions, difficulty, created_at')
      .eq('set_code', set_code)
      .order('question_index', { ascending: true });

    if (error) {
      console.error('GET /set/multi/:set_code error:', error);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }

    res.json({ questions: data || [] });
  } catch (err) {
    console.error('GET /set/multi/:set_code exception:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
