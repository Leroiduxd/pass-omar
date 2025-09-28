// routes/generate.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

router.post('/generate-mcq', async (req, res) => {
  try {
    const { courseId, n } = req.body || {};
    const count = Number(n) || 10;
    if (!courseId || count < 1 || count > 50) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis, n entre 1 et 50.' });
    }

    // 1) Lire le cours
    const { data: course, error } = await supabase
      .from('courses')
      .select('id, ue_number, title, content')
      .eq('id', courseId)
      .single();

    if (error || !course) return res.status(404).json({ error: 'Cours introuvable.' });

    // 2) Préparer prompt
    const MAX_CHARS = 20000;
    const content = (course.content || '').slice(0, MAX_CHARS);

    const system = `Tu es un enseignant PASS.
Tu crées des QCM fiables et piégeux mais justes, uniquement à partir du texte fourni.
Toujours répondre au format JSON STRICT demandé, sans texte hors JSON.`;

    const user = `Cours (titre: "${course.title}", UE ${course.ue_number}):
"""
${content}
"""

Tâche:
Génère ${count} questions QCM pertinentes couvrant l'ensemble du cours.
Contraintes:
- 4 options A–D.
- EXACTEMENT UNE seule bonne réponse par question.
- Interdit "toutes les réponses sont vraies/fausses".
- Pas d'informations hors du texte.
- Français concis.
- Ajoute une explication brève (1–3 phrases) pour chaque question.

Format JSON STRICT (tableau):
[
  {
    "question": "…",
    "options": {"A":"…","B":"…","C":"…","D":"…"},
    "answer": "A",
    "explanation": "…"
  },
  ...
]`;

    // 3) Appel modèle
    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, max_tokens: 3000 }
    );

    // 4) Parse JSON
    const jsonText = extractJson(llmOut);
    let items;
    try {
      items = JSON.parse(jsonText);
      if (!Array.isArray(items)) throw new Error('Root is not array');
    } catch {
      return res.status(422).json({ error: 'JSON invalide renvoyé par le modèle.', raw: llmOut.slice(0, 2000) });
    }

    // 5) Construire les lignes à insérer
    const set_code = randomUUID();
    const rows = items.map((it, i) => ({
      set_code,
      question_index: i + 1,
      question: String(it.question || '').trim(),
      options: it.options || {},
      answer: String(it.answer || '').trim(),
      explanation: String(it.explanation || '').trim()
    }));

    // 6) Insert en DB et récupérer les IDs
    const { data: inserted, error: insErr } = await supabase
      .from('questions')
      .insert(rows)
      .select('id, set_code, question_index, question, options, answer, explanation')
      .order('question_index', { ascending: true });

    if (insErr) {
      console.error('Insert questions error:', insErr);
      return res.status(500).json({ error: 'Erreur insertion questions.' });
    }

    // 7) Réponse finale (avec question_id)
    const outItems = inserted.map(r => ({
      question_id: r.id,
      set_code: r.set_code,
      question_index: r.question_index,
      question: r.question,
      options: r.options,
      answer: r.answer,
      explanation: r.explanation
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
