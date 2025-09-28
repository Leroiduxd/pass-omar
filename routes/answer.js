// routes/answer.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

/**
 * POST /api/answer-mcq
 * Body: { questionId: string, chosen: "A"|"B"|"C"|"D", userId?: string }
 * - Lit la question pour connaître la bonne réponse
 * - Enregistre la tentative (attempts)
 * - Renvoie { is_correct, correct_answer, explanation }
 */
router.post('/answer-mcq', async (req, res) => {
  try {
    const { questionId, chosen, userId } = req.body || {};
    const choice = String(chosen || '').toUpperCase();

    if (!questionId || !['A','B','C','D'].includes(choice)) {
      return res.status(400).json({ error: 'Paramètres invalides: questionId et chosen (A-D) requis.' });
    }

    // 1) Lire la question
    const { data: q, error: qErr } = await supabase
      .from('questions')
      .select('id, set_code, question_index, answer, explanation')
      .eq('id', questionId)
      .single();

    if (qErr || !q) return res.status(404).json({ error: 'Question introuvable.' });

    // 2) Evaluer
    const is_correct = (choice === String(q.answer || '').toUpperCase());

    // 3) Insérer tentative
    const { error: aErr } = await supabase
      .from('attempts')
      .insert([{
        set_code: q.set_code,
        question_id: q.id,
        question_index: q.question_index,
        user_id: userId || null,
        chosen: choice,
        is_correct
      }]);

    if (aErr) {
      console.error('Insert attempt error:', aErr);
      return res.status(500).json({ error: 'Erreur enregistrement tentative.' });
    }

    // 4) Réponse
    res.json({
      is_correct,
      correct_answer: q.answer,
      explanation: q.explanation
    });
  } catch (err) {
    console.error('POST /answer-mcq error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
