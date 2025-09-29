// routes/open.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

/**
 * Générer un set de questions ouvertes
 */
router.post('/generate-open', async (req, res) => {
  try {
    const { courseId, n, difficulty } = req.body || {};
    const count = Number(n) || 5;
    const diff = difficulty ? Math.min(5, Math.max(1, Number(difficulty))) : null;

    if (!courseId || count < 1 || count > 50) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis, n entre 1 et 50.' });
    }

    // 1) Charger le cours
    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('id, ue_number, title, refined_content, raw_content')
      .eq('id', courseId)
      .single();

    if (cErr) {
      console.error('Supabase course read error (open):', cErr);
      return res.status(500).json({ error: 'Erreur lecture cours.' });
    }
    if (!course) return res.status(404).json({ error: 'Cours introuvable.' });

    const baseText = course.refined_content || course.raw_content || '';
    if (!baseText) return res.status(400).json({ error: 'Aucun contenu disponible pour ce cours.' });

    const MAX_CHARS = 20000;
    const content = baseText.slice(0, MAX_CHARS);

    // 2) Anti-redondance : questions déjà existantes
    const { data: existingOpen } = await supabase
      .from('open_questions')
      .select('prompt')
      .eq('course_id', course.id)
      .order('question_index', { ascending: true });

    const existingOpenPrompts = (existingOpen || []).map(q => q.prompt).filter(Boolean).slice(-100);

    const system = `Tu es un enseignant PASS. Tu crées des questions ouvertes ciblées et non redondantes.
Réponds STRICTEMENT au format JSON.`;

    const difficultyLine = diff
      ? `Chaque question doit avoir une difficulté = ${diff} (1 très simple, 5 difficile mais faisable).`
      : `Varie la difficulté de 1 à 5.`;

    const dedupBlock = existingOpenPrompts.length
      ? `Évite les thèmes déjà posés :\n${existingOpenPrompts.map((s, i) => `- ${s}`).join('\n')}`
      : `Aucune question existante.`;

    const user = `Cours: "${course.title}" (UE ${course.ue_number})
"""
${content}
"""

Tâche:
- Génère ${count} questions ouvertes non redondantes.
- Donne une "réponse de référence" claire (3–6 phrases max).
- ${difficultyLine}

Format JSON STRICT (tableau) :
[
  {"prompt":"…","reference_answer":"…","difficulty":3},
  ...
]`;

    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, max_tokens: 3000 }
    );

    const json = extractJson(llmOut);
    let items;
    try {
      items = JSON.parse(json);
      if (!Array.isArray(items)) throw new Error('Root is not array');
    } catch {
      return res.status(422).json({ error: 'JSON invalide renvoyé par le modèle.', raw: llmOut.slice(0, 2000) });
    }

    // 3) Insertion en DB
    const set_code = randomUUID();
    const rows = items.map((it, i) => ({
      set_code,
      course_id: course.id,
      question_index: i + 1,
      prompt: String(it.prompt || '').trim(),
      reference_answer: String(it.reference_answer || '').trim(),
      difficulty: Number(it.difficulty ?? (diff || 3))
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('open_questions')
      .insert(rows)
      .select('id, set_code, course_id, question_index, prompt, reference_answer, difficulty')
      .order('question_index', { ascending: true });

    if (insErr) {
      console.error('Insert open_questions error:', insErr);
      return res.status(500).json({ error: 'Erreur insertion open_questions.' });
    }

    res.json({ set_code, items: inserted });
  } catch (err) {
    console.error('POST /generate-open error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * Corriger une réponse d’utilisateur
 */
router.post('/grade-open', async (req, res) => {
  try {
    const { open_question_id, answer, user_id } = req.body || {};
    if (!open_question_id || !answer) {
      return res.status(400).json({ error: 'open_question_id et answer requis.' });
    }

    // 1) Charger la question
    const { data: oq, error: qErr } = await supabase
      .from('open_questions')
      .select('id, set_code, question_index, course_id, prompt, reference_answer')
      .eq('id', open_question_id)
      .single();

    if (qErr || !oq) return res.status(404).json({ error: 'Question ouverte introuvable.' });

    // 2) Charger le cours pour contexte
    const { data: course } = await supabase
      .from('courses')
      .select('content, raw_content, refined_content, title, ue_number')
      .eq('id', oq.course_id)
      .single();

    const courseSnippet = (course?.refined_content || course?.raw_content || '').slice(0, 12000);

    // 3) Prompt de correction
    const system = `Tu es correcteur PASS. Note une réponse selon:
- Exactitude (0–0.4)
- Complétude (0–0.4)
- Clarté (0–0.2)
Rends uniquement un JSON STRICT.`;

    const user = `Cours (extrait):
"""
${courseSnippet}
"""

Question: ${oq.prompt}

Réponse attendue: ${oq.reference_answer}

Réponse de l'élève: ${answer}

Donne un JSON strict :
{
  "exactitude": 0.0,
  "completude": 0.0,
  "clarte": 0.0,
  "score_final": 0.0,
  "feedback": "..."
}`;

    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.0, max_tokens: 600 }
    );

    const json = extractJson(llmOut);
    let grading;
    try {
      grading = JSON.parse(json);
    } catch {
      return res.status(422).json({ error: 'Réponse IA invalide.', raw: llmOut.slice(0, 1200) });
    }

    const score = clamp01(Number(grading.score_final ?? 0));
    const breakdown = {
      exactitude: clamp01(Number(grading.exactitude ?? 0)),
      completude: clamp01(Number(grading.completude ?? 0)),
      clarte: clamp01(Number(grading.clarte ?? 0))
    };
    const feedback = String(grading.feedback || '').trim();

    // 4) Enregistrer la tentative
    await supabase.from('open_answers').insert([{
      open_question_id: oq.id,
      set_code: oq.set_code,
      question_index: oq.question_index,
      user_id: user_id || null,
      answer,
      score,
      feedback,
      breakdown
    }]);

    res.json({ score, feedback, breakdown });
  } catch (err) {
    console.error('POST /grade-open error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Utils
function extractJson(s) {
  if (!s) return '{}';
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m && m[1]) return m[1];
  const startObj = s.indexOf('{'); const endObj = s.lastIndexOf('}');
  const startArr = s.indexOf('['); const endArr = s.lastIndexOf(']');
  if (startArr !== -1 && endArr > startArr) return s.slice(startArr, endArr + 1);
  if (startObj !== -1 && endObj > startObj) return s.slice(startObj, endObj + 1);
  return s;
}
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

module.exports = router;
