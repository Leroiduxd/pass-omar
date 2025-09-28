// routes/open.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

/**
 * POST /api/generate-open
 * Body: { courseId: string, n?: number }
 * -> Génère n questions ouvertes + réponses de référence,
 *    stocke dans open_questions avec un set_code, renvoie { set_code, items }
 */
router.post('/generate-open', async (req, res) => {
  try {
    const { courseId, n } = req.body || {};
    const count = Number(n) || 5;
    if (!courseId || count < 1 || count > 50) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis, n entre 1 et 50.' });
    }

    // 1) Récup cours
    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('id, ue_number, title, content')
      .eq('id', courseId)
      .single();

    if (cErr || !course) return res.status(404).json({ error: 'Cours introuvable.' });

    const MAX_CHARS = 20000;
    const content = (course.content || '').slice(0, MAX_CHARS);

    // 2) Prompt génération de questions ouvertes + réponses de réf
    const system = `Tu es un enseignant PASS. Tu crées des questions ouvertes courtes, précises et corrigées,
uniquement à partir du texte fourni. Réponds STRICTEMENT au format JSON demandé.`;

    const user = `Cours (titre: "${course.title}", UE ${course.ue_number}):
"""
${content}
"""

Tâche:
Propose ${count} questions ouvertes couvrant des points clés variés du cours.
Pour chacune, fournis aussi une "réponse de référence" concise (3–6 phrases max).

Contraintes:
- Français, précis, sans hors-sujet.
- Les questions doivent être fermes et vérifiables depuis le texte fourni.

Format JSON STRICT:
[
  {"prompt":"…","reference_answer":"…"},
  ...
]`;

    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: 0.2, max_tokens: 2500 }
    );

    const json = extractJson(llmOut);
    let items;
    try {
      items = JSON.parse(json);
      if (!Array.isArray(items)) throw new Error('Root is not array');
    } catch {
      return res.status(422).json({ error: 'JSON invalide renvoyé par le modèle.', raw: llmOut.slice(0, 2000) });
    }

    // 3) Insert en DB
    const set_code = randomUUID();
    const rows = items.map((it, i) => ({
      set_code,
      course_id: course.id,
      question_index: i + 1,
      prompt: String(it.prompt || '').trim(),
      reference_answer: String(it.reference_answer || '').trim()
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('open_questions')
      .insert(rows)
      .select('id, set_code, question_index, prompt, reference_answer')
      .order('question_index', { ascending: true });

    if (insErr) {
      console.error('Insert open_questions error:', insErr);
      return res.status(500).json({ error: 'Erreur insertion open_questions.' });
    }

    res.json({
      set_code,
      items: inserted
    });
  } catch (err) {
    console.error('POST /generate-open error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * POST /api/grade-open
 * Body: { open_question_id: string, answer: string, user_id?: string }
 * -> Lit la question + ref answer (+ cours), fait noter par IA selon barème,
 *    enregistre dans open_answers, renvoie { score, feedback, breakdown }
 */
router.post('/grade-open', async (req, res) => {
  try {
    const { open_question_id, answer, user_id } = req.body || {};
    if (!open_question_id || !answer) {
      return res.status(400).json({ error: 'open_question_id et answer requis.' });
    }

    // 1) Lire la question + cours
    const { data: oq, error: qErr } = await supabase
      .from('open_questions')
      .select('id, set_code, question_index, course_id, prompt, reference_answer')
      .eq('id', open_question_id)
      .single();

    if (qErr || !oq) return res.status(404).json({ error: 'Question ouverte introuvable.' });

    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('content, title, ue_number')
      .eq('id', oq.course_id)
      .single();

    if (cErr || !course) return res.status(404).json({ error: 'Cours introuvable.' });

    const MAX_CHARS = 12000; // plus court pour la correction
    const courseSnippet = (course.content || '').slice(0, MAX_CHARS);

    // 2) Prompt notation (barème 1 min ≈ concision/structure implicite)
    const system = `Tu es correcteur PASS. Note une réponse courte selon:
- Exactitude factuelle (0–0.4)
- Complétude des points clés (0–0.4)
- Clarté/structure (0–0.2)
Donne un JSON STRICT, sans texte autour.`;

    const user = `Cours (extrait, source de vérité):
"""
${courseSnippet}
"""

Question:
${oq.prompt}

Réponse attendue (référence):
${oq.reference_answer}

Réponse de l'élève:
${answer}

Consigne:
Compare la réponse de l'élève à la référence et au cours.
Attribue un score détaillé:
- "exactitude": 0.0–0.4
- "completude": 0.0–0.4
- "clarte": 0.0–0.2
- "score_final": somme arrondie à 0.05 (0.0–1.0)
- "feedback": 2–4 phrases de retour ciblé.

Format JSON STRICT:
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
      if (typeof grading !== 'object') throw new Error('Not an object');
    } catch {
      return res.status(422).json({ error: 'JSON de grading invalide.', raw: llmOut.slice(0, 1200) });
    }

    // Normaliser
    const score = clamp01(Number(grading.score_final ?? 0));
    const breakdown = {
      exactitude: clamp01(Number(grading.exactitude ?? 0)),
      completude: clamp01(Number(grading.completude ?? 0)),
      clarte: clamp01(Number(grading.clarte ?? 0))
    };
    const feedback = String(grading.feedback || '').trim();

    // 3) Enregistrer la tentative
    const { error: aErr } = await supabase
      .from('open_answers')
      .insert([{
        open_question_id: oq.id,
        set_code: oq.set_code,
        question_index: oq.question_index,
        user_id: user_id || null,
        answer,
        score,
        feedback,
        breakdown
      }]);

    if (aErr) {
      console.error('Insert open_answers error:', aErr);
      return res.status(500).json({ error: 'Erreur enregistrement tentative.' });
    }

    // 4) Réponse
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
  // fallback: extraire objet { ... } ou tableau [ ... ]
  const startObj = s.indexOf('{'); const endObj = s.lastIndexOf('}');
  const startArr = s.indexOf('['); const endArr = s.lastIndexOf(']');
  const objSpan = (startObj !== -1 && endObj > startObj) ? endObj - startObj : -1;
  const arrSpan = (startArr !== -1 && endArr > startArr) ? endArr - startArr : -1;
  if (arrSpan > objSpan && arrSpan > 0) return s.slice(startArr, endArr + 1);
  if (objSpan > 0) return s.slice(startObj, endObj + 1);
  return s;
}
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

module.exports = router;
