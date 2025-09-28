// routes/generate.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

router.post('/generate-mcq', async (req, res) => {
  try {
    const { courseId, n, difficulty } = req.body || {};
    const count = Number(n) || 10;
    const diff = difficulty ? Math.min(5, Math.max(1, Number(difficulty))) : null;

    if (!courseId || count < 1 || count > 50) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis, n entre 1 et 50.' });
    }

    // 1) Lire le cours
    const { data: course, error } = await supabase
      .from('courses')
      .select('id, ue_number, title, refined_content, raw_content, content')
      .eq('id', courseId)
      .single();
    if (error || !course) return res.status(404).json({ error: 'Cours introuvable.' });

    const baseText = course.refined_content || course.raw_content || course.content || '';
    if (!baseText) return res.status(400).json({ error: 'Aucun contenu (raw/refined/content) pour ce cours.' });

    const MAX_CHARS = 20000;
    const content = baseText.slice(0, MAX_CHARS);

    // 2) Anti-redondance : questions ouvertes du même cours
    const { data: existingOpen } = await supabase
      .from('open_questions')
      .select('prompt')
      .eq('course_id', course.id)
      .order('question_index', { ascending: true });
    const existingOpenPrompts = (existingOpen || []).map(q => q.prompt).filter(Boolean).slice(-100);

    // 3) Anti-redondance : QCM déjà générés pour ce cours (grâce à course_id)
    const { data: existMcqSameCourse } = await supabase
      .from('questions')
      .select('question')
      .eq('course_id', course.id)
      .order('question_index', { ascending: true });
    const existingMcqQuestions = (existMcqSameCourse || []).map(q => q.question).filter(Boolean);

    const system = `Tu es un enseignant PASS. Tu crées des QCM NON REDONDANTS, fiables et justes.
Réponds STRICTEMENT au format JSON (voir plus bas).`;

    const difficultyLine = diff
      ? `Chaque question doit avoir une difficulté = ${diff} (1 très simple, 5 difficile mais faisable).`
      : `Varie la difficulté globale (1 à 5) : un tiers faciles, un tiers moyens, un tiers difficiles.`;

    const dedupBlock = [
      existingOpenPrompts.length ? `Évite les thèmes déjà couverts par ces questions ouvertes :\n${existingOpenPrompts.map((s, i)=>`- O${i+1}: ${s}`).join('\n')}` : `Pas de questions ouvertes existantes pour ce cours.`,
      existingMcqQuestions.length ? `Évite les énoncés déjà posés (QCM de ce cours) :\n${existingMcqQuestions.slice(-100).map((s,i)=>`- M${i+1}: ${s}`).join('\n')}` : `Pas de QCM existants pour ce cours.`
    ].join('\n\n');

    const user = `Cours (titre: "${course.title}", UE ${course.ue_number}):
"""
${content}
"""

Tâche:
Génère ${count} questions QCM pertinentes, **non redondantes** avec l'existant ci-dessous, couvrant des parties différentes du cours.
- ${difficultyLine}

Contraintes:
- 4 options A–D.
- EXACTEMENT UNE seule bonne réponse par question.
- Pas de "toutes les réponses sont vraies/fausses".
- Français concis, formulation nette.
- Ajoute une explication brève (1–3 phrases) pour chaque question.

Anti-redondance :
${dedupBlock}

Format JSON STRICT (tableau):
[
  {
    "question": "…",
    "options": {"A":"…","B":"…","C":"…","D":"…"},
    "answer": "A",
    "explanation": "…",
    "difficulty": 3
  },
  ...
]`;

    // 4) Appel modèle
    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, max_tokens: 3500 }
    );

    // 5) Parse JSON
    const jsonText = extractJson(llmOut);
    let items;
    try {
      items = JSON.parse(jsonText);
      if (!Array.isArray(items)) throw new Error('Root is not array');
    } catch {
      return res.status(422).json({ error: 'JSON invalide renvoyé par le modèle.', raw: llmOut.slice(0, 2000) });
    }

    // 6) Insert en DB (avec course_id + difficulty)
    const set_code = randomUUID();
    const rows = items.map((it, i) => ({
      set_code,
      course_id: course.id,
      question_index: i + 1,
      question: String(it.question || '').trim(),
      options: it.options || {},
      answer: String(it.answer || '').trim(),
      explanation: String(it.explanation || '').trim(),
      difficulty: Number(it.difficulty ?? (diff || 3))
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('questions')
      .insert(rows)
      .select('id, set_code, course_id, question_index, question, options, answer, explanation, difficulty')
      .order('question_index', { ascending: true });
    if (insErr) {
      console.error('Insert questions error:', insErr);
      return res.status(500).json({ error: 'Erreur insertion questions.' });
    }

    // 7) Réponse finale
    const outItems = inserted.map((r) => ({
      question_id: r.id,
      set_code: r.set_code,
      course_id: r.course_id,
      question_index: r.question_index,
      question: r.question,
      options: r.options,
      answer: r.answer,
      explanation: r.explanation,
      difficulty: r.difficulty
    }));

    res.json({ set_code, items: outItems });
  } catch (err) {
    console.error('POST /generate-mcq error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

function extractJson(s) {
  if (!s) return '[]';
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m && m[1]) return m[1];
  const start = s.indexOf('['); const end = s.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);
  return s;
}

module.exports = router;
