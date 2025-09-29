// routes/open.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

router.post('/generate-open', async (req, res) => {
  try {
    const { courseId, n, difficulty } = req.body || {};
    const count = Number(n) || 5;
    const diff = difficulty ? Math.min(5, Math.max(1, Number(difficulty))) : null;

    if (!courseId || count < 1 || count > 50) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis, n entre 1 et 50.' });
    }

    // 1) Cours (refined prioritaire) — NE PLUS SÉLECTIONNER "content"
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
    if (!baseText) return res.status(400).json({ error: 'Aucun contenu (raw/refined) pour ce cours.' });

    const MAX_CHARS = 20000;
    const content = baseText.slice(0, MAX_CHARS);

    // 2) Questions ouvertes existantes (anti-redondance)
    const { data: existingOpen, error: eoErr } = await supabase
      .from('open_questions')
      .select('prompt')
      .eq('course_id', course.id)
      .order('question_index', { ascending: true });

    if (eoErr) {
      console.error('Supabase open dedup read error:', eoErr);
    }

    const existingOpenPrompts = (existingOpen || [])
      .map(q => q.prompt)
      .filter(Boolean)
      .slice(-100);

    const system = `Tu es un enseignant PASS. Tu crées des questions ouvertes ciblées et non redondantes.
Réponds STRICTEMENT en JSON (voir format).`;

    const difficultyLine = diff
      ? `Chaque question doit avoir une difficulté = ${diff} (1 très simple, 5 difficile mais faisable).`
      : `Varie la difficulté sur l'ensemble (1 à 5) sans questions ridicules ni trop pointilleuses.`;

    const dedupBlock = existingOpenPrompts.length
      ? `Évite tout recouvrement avec ces questions déjà posées pour ce cours :
${existingOpenPrompts.map((s, i) => `- Q${i+1}: ${s}`).join('\n')}`
      : `Il n'y a pas de questions ouvertes existantes pour ce cours.`;

    const user = `Cours (titre: "${course.title}", UE ${course.ue_number}):
"""
${content}
"""

Tâche:
- Génère ${count} questions OUVERTES non redondantes couvrant des points clés variés du cours.
- Fournis une "réponse de référence" concise (3–6 phrases max).
- ${difficultyLine}

Contraintes:
- Français, précis, strictement à partir du cours (aucun hors-sujet).
- Les questions doivent être fermes et vérifiables depuis le texte fourni.
- Pas de duplication des sujets déjà traités ci-dessous.

Anti-redondance:
${dedupBlock}

Format JSON STRICT (tableau):
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

    // 3) Insert en DB (avec difficulty)
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

/* Si tu as déjà un /grade-open dans ce fichier, laisse-le inchangé. */

function extractJson(s) {
  if (!s) return '[]';
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m && m[1]) return m[1];
  const startArr = s.indexOf('['); const endArr = s.lastIndexOf(']');
  if (startArr !== -1 && endArr !== -1 && endArr > startArr) return s.slice(startArr, endArr + 1);
  return s;
}

module.exports = router;


