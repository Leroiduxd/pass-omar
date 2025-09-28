// routes/refine.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');

const MAX_CHUNK = 8000; // ~8k caractères par chunk pour rester safe

// POST /api/refine-course  { courseId: string }
router.post('/refine-course', async (req, res) => {
  try {
    const { courseId } = req.body || {};
    if (!courseId) {
      return res.status(400).json({ error: 'courseId requis.' });
    }

    // 1) Lire la transcription brute
    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('id, title, ue_number, raw_content')
      .eq('id', courseId)
      .single();

    if (cErr || !course) return res.status(404).json({ error: 'Cours introuvable.' });
    const raw = String(course.raw_content || '').trim();
    if (!raw) return res.status(400).json({ error: 'raw_content vide pour ce cours.' });

    // 2) Split en chunks lisibles (en conservant l’ordre)
    const chunks = splitForRefine(raw, MAX_CHUNK);

    // 3) Prompt de consigne — strict sur l’ordre / pas d’info supprimée
    const system = `Tu es un scribe pédagogique.
Tu réécris un cours à partir d'une transcription Whisper pour le rendre clair et structuré,
EN RESPECTANT *STRICTEMENT* L'ORDRE du texte source, SANS supprimer d'informations.
- Conserver les termes techniques EXACTS du professeur.
- Ne JAMAIS inventer de nouveaux faits.
- Tu peux reformuler pour la clarté (phrases complètes), ajouter de brèves précisions explicatives si nécessaire,
  mais JAMAIS retirer une information présente.
- Le résultat doit ressembler à un poly "mis au propre" fidèle au cours.`;

    // 4) Traiter les chunks séquentiellement
    let parts = [];
    for (let i = 0; i < chunks.length; i++) {
      const user = `Cours (partie ${i + 1}/${chunks.length}) :
"""
${chunks[i]}
"""

Consigne:
- Réécris cette partie SEULEMENT, en respectant l'ordre interne des idées.
- Conserve toutes les informations.
- Améliore la lisibilité (titres, puces si utiles, phrases complètes).
- N'utilise aucune introduction/conclusion globale, pas de résumé hors texte.
- Ne pas renuméroter d'une manière qui casse l'ordre d'origine.
- N'ajoute pas de contenu externe; autorisées: brèves clarifications (entre parenthèses) si ça aide à comprendre.

Réponds par le TEXTE seul (markdown simple autorisé), sans autre balise.`;

      const { content: refinedPart } = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        { temperature: 0.1, max_tokens: 2500 }
      );

      parts.push(refinedPart.trim());
    }

    const refined = parts.join('\n\n');

    // 5) Enregistrer dans refined_content
    const { error: uErr } = await supabase
      .from('courses')
      .update({ refined_content: refined })
      .eq('id', courseId);

    if (uErr) {
      console.error('Update refined_content error:', uErr);
      return res.status(500).json({ error: 'Erreur enregistrement refined_content.' });
    }

    res.json({ courseId, refined_length: refined.length, chunks: chunks.length, ok: true });
  } catch (err) {
    console.error('POST /refine-course error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Découpage "propre" sur doubles sauts de ligne / titres / phrases
function splitForRefine(text, max) {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n{2,}/); // blocs séparés par lignes vides
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    const candidate = (buf ? buf + '\n\n' : '') + p;
    if (candidate.length > max) {
      if (buf) chunks.push(buf);
      if (p.length > max) {
        // si un paragraphe est énorme, on coupe par phrases
        const parts = p.split(/(?<=[\.!\?])\s+/);
        let sb = '';
        for (const s of parts) {
          const cand2 = (sb ? sb + ' ' : '') + s;
          if (cand2.length > max) {
            if (sb) chunks.push(sb);
            sb = s;
          } else {
            sb = cand2;
          }
        }
        if (sb) chunks.push(sb);
        buf = '';
      } else {
        chunks.push(p);
        buf = '';
      }
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

module.exports = router;
