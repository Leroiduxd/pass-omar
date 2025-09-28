// routes/generate.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

// Normalisation simple pour comparer des intitulés
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/[^a-z0-9 ]+/g, ' ')                     // ponctuation
    .replace(/\s+/g, ' ')                              // espaces
    .trim();
}

router.post('/generate-mcq', async (req, res) => {
  try {
    const { courseId, n, difficulty } = req.body || {};
    const count = Math.min(50, Math.max(1, Number(n) || 10));
    const lvl = Math.min(5, Math.max(1, Number(difficulty) || 3));

    if (!courseId) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis.' });
    }

    // 1) Lire le cours (on privilégie refined_content s’il existe)
    const { data: course, error } = await supabase
      .from('courses')
      .select('id, ue_number, title, refined_content, raw_content')
      .eq('id', courseId)
      .single();

    if (error || !course) return res.status(404).json({ error: 'Cours introuvable.' });

    const source = course.refined_content || course.raw_content || '';
    const MAX_CHARS = 20000;
    const content = source.slice(0, MAX_CHARS);

    // 2) Récupérer les QCM déjà posés pour CE cours (stems pour exclusion)
    const { data: prev, error: prevErr } = await supabase
      .from('questions')
      .select('question')
      .eq('course_id', course.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (prevErr) {
      console.error('Fetch existing questions error:', prevErr);
    }
    const prevStems = (prev || []).map(r => r.question).filter(Boolean);
    const prevNormSet = new Set(prevStems.map(norm));

    // 3) Prompt : éviter redondance + niveau de difficulté
    const system = `Tu es un enseignant PASS.
Tu crées des QCM fiables et discriminants à partir du texte donné.
NE PAS répéter des idées déjà posées quand une liste d'exclusions est fournie.
Réponds STRICTEMENT au format JSON demandé, sans texte hors JSON.`;

    const difficultyGuide = {
      1: 'niveau 1 = basique: définitions, idées clés directes (mais pas trivia).',
      2: 'niveau 2 = fondamental: compréhension simple + un piège léger.',
      3: 'niveau 3 = standard: compréhension + application simple.',
      4: 'niveau 4 = avancé: mise en relation de notions, pièges modérés.',
      5: 'niveau 5 = exigeant: raisonnement précis, détails pertinents (pas encyclo).'
    }[lvl];

    // Limiter la taille de la liste d’exclusion dans le prompt
    const EXCLUDE_MAX = 30;
    const excludeList = prevStems.slice(0, EXCLUDE_MAX)
      .map((q, i) => `${i + 1}. ${q}`).join('\n');

    const user = `Cours (titre: "${course.title}", UE ${course.ue_number}):
"""
${content}
"""

Génère ${count} QCM de difficulté ${lvl} (${difficultyGuide})
Contraintes:
- 4 options A–D.
- EXACTEMENT UNE seule bonne réponse par question.
- Interdit "toutes les réponses sont vraies/fausses" ou formulations équivalentes.
- Français concis.
- Ajoute une explication brève (1–3 phrases) par question.
- Évite les thèmes/formulations déjà posés ci-dessous.

Déjà posées (à éviter):
${excludeList || '(aucune)'}

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

    // 4) Appel modèle
    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, max_tokens: 3200 }
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

    // 6) Filtre anti-doublon côté serveur (exact/approximations simples)
    const seen = new Set(prevNormSet);
    const filtered = [];
    for (const it of items) {
      const stem = norm(it.question);
      if (!stem) continue;
      if (seen.has(stem)) continue;
      // petite heuristique: si un ancien stem contient le nouveau (ou inverse)
      let near = false;
      for (const s of prevNormSet) {
        if (stem.length > 20 && (s.includes(stem) || stem.includes(s))) { near = true; break; }
      }
      if (near) continue;
      seen.add(stem);
      filtered.push(it);
      if (filtered.length === count) break;
    }

    if (filtered.length === 0) {
      return res.status(409).json({ error: 'Impossible de générer de nouvelles questions non redondantes.' });
    }

    // 7) Insert en DB (avec course_id + difficulty)
    const set_code = randomUUID();
    const rows = filtered.map((it, i) => ({
      set_code,
      course_id: course.id,
      difficulty: lvl,
      question_index: i + 1,
      question: String(it.question || '').trim(),
      options: it.options || {},
      answer: String(it.answer || '').trim(),
      explanation: String(it.explanation || '').trim()
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('questions')
      .insert(rows)
      .select('id, set_code, course_id, difficulty, question_index, question, options, answer, explanation')
      .order('question_index', { ascending: true });

    if (insErr) {
      console.error('Insert questions error:', insErr);
      return res.status(500).json({ error: 'Erreur insertion questions.' });
    }

    const outItems = inserted.map(r => ({
      question_id: r.id,
      set_code: r.set_code,
      course_id: r.course_id,
      difficulty: r.difficulty,
      question_index: r.question_index,
      question: r.question,
      options: r.options,
      answer: r.answer,
      explanation: r.explanation
    }));

    res.json({ set_code, difficulty: lvl, items: outItems });
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

