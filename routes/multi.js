// routes/multi.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

/**
 * POST /api/generate-multi
 * Body: { courseId: string, n?: number, difficulty?: 1..5 }
 * -> Génère N questions "multi-sélection" (5 propositions A–E corrélées),
 *    avec is_true + explication par proposition,
 *    en évitant de répéter les thèmes déjà posés pour ce cours.
 *    Stocke dans ms_questions avec un set_code unique.
 */
router.post('/generate-multi', async (req, res) => {
  try {
    const { courseId, n, difficulty } = req.body || {};
    const count = Math.min(50, Math.max(1, Number(n) || 10));
    const diff = difficulty ? Math.min(5, Math.max(1, Number(difficulty))) : null;

    if (!courseId) return res.status(400).json({ error: 'courseId requis.' });

    // 1) Charger le cours (refined prioritaire)
    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('id, ue_number, title, refined_content, raw_content')
      .eq('id', courseId)
      .single();

    if (cErr) {
      console.error('Supabase read course (multi):', cErr);
      return res.status(500).json({ error: 'Erreur lecture cours.' });
    }
    if (!course) return res.status(404).json({ error: 'Cours introuvable.' });

    const baseText = course.refined_content || course.raw_content || '';
    if (!baseText) return res.status(400).json({ error: 'Aucun contenu (raw/refined) pour ce cours.' });

    const MAX_CHARS = 20000;
    const content = baseText.slice(0, MAX_CHARS);

    // 2) Anti-redondance: relever les thèmes déjà posés en multi sur ce cours
    const { data: existingMs, error: mErr } = await supabase
      .from('ms_questions')
      .select('stem')
      .eq('course_id', course.id)
      .order('question_index', { ascending: true });

    if (mErr) console.error('Supabase read ms dedup:', mErr);
    const existingStems = (existingMs || []).map(r => r.stem).filter(Boolean).slice(-150);

    // 3) Prompt LLM
    const system = `Tu es un enseignant PASS. Tu crées des questions multi-sélection à partir du texte fourni.
Pour chaque question:
- Propose un "stem" (énoncé) court et clair.
- Fournis EXACTEMENT 5 propositions A..E, liées entre elles (même sous-thème).
- Marque "is_true" pour les propositions vraies, false sinon (au moins 1 vraie).
- Ajoute une brève "explanation" par proposition (1–2 phrases).
- Ne pas inventer: s'appuyer uniquement sur le texte fourni.
Réponds STRICTEMENT en JSON (voir format).`;

    const difficultyLine = diff
      ? `Toutes les questions doivent avoir une difficulté = ${diff} (1 très simple, 5 difficile mais faisable).`
      : `Varie la difficulté sur l'ensemble (1 à 5).`;

    const dedupBlock = existingStems.length
      ? `Évite de reposer les mêmes thèmes/énoncés déjà posés (exemples):
${existingStems.map((s,i)=>`- ${s}`).join('\n')}`
      : `Aucun historique multi-sélection pour ce cours.`;

    const user = `Cours: "${course.title}" (UE ${course.ue_number})
Source (extrait):
"""
${content}
"""

Tâche:
- Génère ${count} questions multi-sélection NON REDONDANTES, couvrant des parties différentes du cours.
- ${difficultyLine}

Contraintes:
- 5 propositions par question (A..E).
- Au moins UNE proposition vraie, pas de doublons contradictoires.
- Français concis. Pas de hors-sujet.

Anti-redondance:
${dedupBlock}

FORMAT JSON STRICT (tableau):
[
  {
    "stem": "…",
    "propositions": [
      {"label":"A","text":"…","is_true":true,"explanation":"…"},
      {"label":"B","text":"…","is_true":false,"explanation":"…"},
      {"label":"C","text":"…","is_true":true,"explanation":"…"},
      {"label":"D","text":"…","is_true":false,"explanation":"…"},
      {"label":"E","text":"…","is_true":false,"explanation":"…"}
    ],
    "difficulty": 3
  }
]`;

    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, max_tokens: 3500 }
    );

    // 4) Parse
    const json = extractJson(llmOut);
    let items;
    try {
      items = JSON.parse(json);
      if (!Array.isArray(items)) throw new Error('Root is not array');
    } catch (e) {
      return res.status(422).json({ error: 'JSON invalide renvoyé par le modèle.', raw: llmOut.slice(0, 2000) });
    }

    // Validation minimale
    for (const it of items) {
      if (!it || !it.stem || !Array.isArray(it.propositions) || it.propositions.length !== 5) {
        return res.status(422).json({ error: 'Format des éléments invalide (stem/propositions).' });
      }
      const labels = it.propositions.map(p => p.label);
      const uniq = new Set(labels);
      if (uniq.size !== 5 || !['A','B','C','D','E'].every(k => uniq.has(k))) {
        return res.status(422).json({ error: 'Les labels doivent être A..E, uniques.' });
      }
      const trues = it.propositions.filter(p => !!p.is_true).length;
      if (trues < 1) {
        return res.status(422).json({ error: 'Chaque question doit avoir au moins une proposition vraie.' });
      }
    }

    // 5) Insert DB
    const set_code = randomUUID();
    const rows = items.map((it, i) => ({
      set_code,
      course_id: course.id,
      question_index: i + 1,
      stem: String(it.stem || '').trim(),
      propositions: it.propositions.map(p => ({
        label: String(p.label || '').toUpperCase(),
        text: String(p.text || '').trim(),
        is_true: !!p.is_true,
        explanation: String(p.explanation || '').trim()
      })),
      difficulty: Number(it.difficulty ?? (diff || 3))
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('ms_questions')
      .insert(rows)
      .select('id, set_code, course_id, question_index, stem, propositions, difficulty')
      .order('question_index', { ascending: true });

    if (insErr) {
      console.error('Insert ms_questions error:', insErr);
      return res.status(500).json({ error: 'Erreur insertion ms_questions.' });
    }

    res.json({
      set_code,
      items: inserted
    });
  } catch (err) {
    console.error('POST /generate-multi error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/set/multi/:set_code
 * -> Récupère toutes les questions multi d’un set (pour prévisualiser/rejouer).
 */
router.get('/set/multi/:set_code', async (req, res) => {
  try {
    const { set_code } = req.params || {};
    if (!set_code) return res.status(400).json({ error: 'set_code requis.' });

    const { data, error } = await supabase
      .from('ms_questions')
      .select('id, set_code, course_id, question_index, stem, propositions, difficulty, created_at')
      .eq('set_code', set_code)
      .order('question_index', { ascending: true });

    if (error) {
      console.error('Read set multi error:', error);
      return res.status(500).json({ error: 'Erreur lecture set.' });
    }
    if (!data || data.length === 0) return res.status(404).json({ error: 'Set introuvable.' });

    res.json({ questions: data });
  } catch (err) {
    console.error('GET /set/multi error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * (Optionnel) POST /api/grade-multi
 * Body: { ms_question_id: string, selected: string[] }  // ex: ["A","C"]
 * -> Corrige localement côté serveur (sans IA) en comparant à propositions[].is_true
 *    et renvoie un score (0..1) + détail par label
 */
router.post('/grade-multi', async (req, res) => {
  try {
    const { ms_question_id, selected } = req.body || {};
    if (!ms_question_id || !Array.isArray(selected)) {
      return res.status(400).json({ error: 'ms_question_id et selected[] requis.' });
    }

    const { data: q, error } = await supabase
      .from('ms_questions')
      .select('id, propositions')
      .eq('id', ms_question_id)
      .single();

    if (error || !q) return res.status(404).json({ error: 'Question introuvable.' });

    const props = q.propositions || [];
    const gold = new Map(props.map(p => [String(p.label).toUpperCase(), !!p.is_true]));
    const chosen = new Set(selected.map(s => String(s).toUpperCase()));

    // Correction: +1 pour chaque bonne case (vraie cochée, fausse non cochée), 0 sinon. Normalisé sur 5.
    let good = 0;
    const detail = [];
    for (const p of props) {
      const lab = String(p.label).toUpperCase();
      const truth = !!p.is_true;
      const checked = chosen.has(lab);
      const correct = (truth && checked) || (!truth && !checked);
      if (correct) good++;
      detail.push({ label: lab, expected: truth, checked, correct, explanation: p.explanation || '' });
    }
    const score = good / props.length;

    res.json({ score, detail });
  } catch (err) {
    console.error('POST /grade-multi error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Utils
function extractJson(s) {
  if (!s) return '[]';
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) return fence[1];
  const start = s.indexOf('['), end = s.lastIndexOf(']');
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  return s;
}

module.exports = router;
