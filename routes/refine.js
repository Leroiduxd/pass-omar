// routes/refine.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { chat } = require('../ai/nscale');

const MAX_CHUNK = 8000; // ~8k caractères d'entrée

router.post('/refine-course', async (req, res) => {
  try {
    const { courseId } = req.body || {};
    if (!courseId) return res.status(400).json({ error: 'courseId requis.' });

    const { data: course, error: cErr } = await supabase
      .from('courses')
      .select('id, title, ue_number, raw_content')
      .eq('id', courseId)
      .single();

    if (cErr || !course) return res.status(404).json({ error: 'Cours introuvable.' });

    const raw = String(course.raw_content || '').trim();
    if (!raw) return res.status(400).json({ error: 'raw_content vide.' });

    const chunks = splitForRefine(raw, MAX_CHUNK);

    // Nouveau prompt
    const system = `Tu es un scribe PASS.
Tu dois transformer une transcription orale en un poly clair et structuré.
Contraintes :
- Respecter strictement la chronologie du professeur. (dans la limite du raisonable, ne jamais sacrifier la clareté à chronologie, et c'est pas grave si tu te répète pour compenser ca)
- Conserver toutes les informations scientifiques et pédagogiques données, pas bêtement se qui a un rapport avec le cours, pas d'info superflux.
- Supprimer les phrases parasites et inutiles (ex: blagues, apartés, café, Gmail).
- Écrire uniquement de vraies phrases fluides, pas de puces ou de flèches.
- Ne rien inventer, mais tu peux ajouter une précision brève si nécessaire à la compréhension.
- Maintenir la longueur et la densité d'informations (ne pas raccourcir trop).`;

    let parts = [];
    for (let i = 0; i < chunks.length; i++) {
      const user = `Voici la partie ${i + 1}/${chunks.length} :
"""
${chunks[i]}
"""

Réécris cette partie comme un cours écrit, en respectant les contraintes ci-dessus.
Réponds uniquement avec le texte rédigé, sans balises ni commentaires.`;

      const { content: refinedPart } = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        { temperature: 0.1, max_tokens: 24000 } // ← augmenté
      );

      parts.push(refinedPart.trim());
    }

    const refined = parts.join('\n\n');

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

function splitForRefine(text, max) {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    const candidate = (buf ? buf + '\n\n' : '') + p;
    if (candidate.length > max) {
      if (buf) chunks.push(buf);
      if (p.length > max) {
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

