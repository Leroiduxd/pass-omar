// routes/manage.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '')
  );

/**
 * 🔴 DELETE /api/courses/:id
 * Supprime un cours (les questions liées conservent leurs lignes mais course_id=NULL).
 *
 * Réponse:
 *   200 { "success": true, "deleted_id": "<uuid>" }
 *   404 { "error": "Cours introuvable." }
 */
router.delete('/courses/:id', async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!isUuid(id)) return res.status(400).json({ error: 'ID invalide.' });

    const { data, error } = await supabase
      .from('courses')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) {
      console.error('Supabase delete course error:', error);
      return res.status(500).json({ error: 'Erreur suppression cours.' });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Cours introuvable.' });
    }

    res.json({ success: true, deleted_id: data[0].id });
  } catch (e) {
    console.error('DELETE /courses/:id error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * 🔵 PATCH /api/courses/:id/move
 * Déplace un cours dans une autre UE.
 * Body: { new_ue_number: number (1..12) }
 *
 * Réponse:
 *   200 {
 *     "success": true,
 *     "course": { id, ue_number, title, raw_content, refined_content }
 *   }
 *   404 { "error": "Cours introuvable." }
 */
router.patch('/courses/:id/move', async (req, res) => {
  try {
    const { id } = req.params || {};
    const { new_ue_number } = req.body || {};

    if (!isUuid(id)) return res.status(400).json({ error: 'ID invalide.' });
    const ue = Number(new_ue_number);
    if (!Number.isInteger(ue) || ue < 1 || ue > 12) {
      return res
        .status(400)
        .json({ error: 'new_ue_number doit être un entier entre 1 et 12.' });
    }

    const { data, error } = await supabase
      .from('courses')
      .update({ ue_number: ue })
      .eq('id', id)
      .select('id, ue_number, title, raw_content, refined_content')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Cours introuvable.' });
      }
      console.error('Supabase move UE error:', error);
      return res.status(500).json({ error: 'Erreur transfert UE.' });
    }

    if (!data) return res.status(404).json({ error: 'Cours introuvable.' });

    res.json({ success: true, course: data });
  } catch (e) {
    console.error('PATCH /courses/:id/move error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

