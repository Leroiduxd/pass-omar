// routes/generate.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');
const { randomUUID } = require('crypto');

/**
 * POST /api/generate-mcq
 * Body: { courseId: string, n?: number }
 * - Récupère le contenu du cours dans Supabase
 * - Appelle Nscale pour générer N QCM (A-D, 1 bonne réponse, explication)
 * - Renvoie: { set_code, items: [...] }
 */
router.post('/generate-mcq', async (req, res) => {
  try {
    const { courseId, n } = req.body || {};
    const count = Number(n) || 10; // défaut 10 questions

    if (!courseId || count < 1 || count > 50) {
      return res.status(400).json({ error: 'Paramètres invalides: courseId requis, n entre 1 et 50.' });
    }

    // 1) Récupérer le cours
    const { data: course, error } = await supabase
      .from('courses')
      .select('id, ue_number, title, content')
      .eq('id', courseId)
      .single();

    if (error || !course) {
      return res.status(404).json({ error: 'Cours introuvable.' });
    }

    // (Option simple) couper si texte énorme pour éviter un prompt trop long
    const MAX_CHARS = 20000;
    const content = (course.content || '').slice(0, MAX_CHARS);

    // 2) Construire les messages pour Nscale (format JSON strict)
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
- Interdit "toutes les réponses sont vraies/fausses" ou variantes.
- Pas d'informations hors du texte.
- Français concis.
- Ajoute une explication brève (1–3 phrases) pour chaque question.

Format JSON STRICT (tableau), pas de texte en dehors:
[
  {
    "question": "…",
    "options": {"A":"…","B":"…","C":"…","D":"…"},
    "answer": "A",
    "explanation": "…"
  },
  ...
]`;

    // 3) Appel Nscale
    const { content: llmOut } = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      {
        // model via .env NSCALE_MODEL si tu veux changer globalement
        temperature: 0.2,
        max_tokens: 3000
      }
    );

    // 4) Extraction JSON robuste (retire d’éventuels ```json ... ```)
    const jsonText = extractJson(llmOut);
    let items;
    try {
      items = JSON.parse(jsonText);
      if (!Array.isArray(items)) throw new Error('Root is not array');
    } catch (e) {
      return res.status(422).json({
        error: 'Impossible de parser la sortie du modèle en JSON.',
        raw: llmOut.slice(0, 2000) // pour debug éventuel
      });
    }

    // 5) Générer un code de lot (set_code) et renvoyer (pas d’insert DB ici)
    const set_code = randomUUID();
    const normalized = items.map((it, i) => ({
      set_code,
      question_index: i + 1,
      question: String(it.question || '').trim(),
      options: it.options || {},
      answer: String(it.answer || '').trim(),
      explanation: String(it.explanation || '').trim()
    }));

    res.json({ set_code, items: normalized });
  } catch (err) {
    console.error('POST /generate-mcq error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Util: extraire un bloc JSON (retire les fences ```json ... ``` si présents)
function extractJson(s) {
  if (!s) return '[]';
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const m = s.match(fence);
  if (m && m[1]) return m[1];
  // sinon, tenter de trouver le premier [ ... ] équilibré
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return s.slice(start, end + 1);
  }
  return s; // dernier recours
}

module.exports = router;
