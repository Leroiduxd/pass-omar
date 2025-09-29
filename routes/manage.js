// routes/manage.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ''));

/**
 * DELETE /api/courses/:id
 * Supprime un cours par id.
 * Réponses:
 *  - 200 { deleted: true, id }
 *  - 404 { error: 'Cours introuvable.' }
 */
router.delete('/courses/:id', async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!isUuid(id)) return res.status(400).json({ error: 'ID invalide.' });

    // On tente de supprimer et on récupère l'id supprimé
    const { data, error } = await supabase
      .from('courses')
      .delete()
      .eq('id', id)
      .select('id'); // PostgREST retourne les lignes supprimées si .select()

    if (error) {
      console.error('Supabase delete course error:', error);
      return res.status(500).json({ error: 'Erreur suppression cours.' });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Cours introuvable.' });
    }

    res.json({ deleted: true, id: data[0].id });
  } catch (e) {
    console.error('DELETE /courses/:id error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});


/**
 * PATCH /api/courses/:id/transfer
 * Body: { ue_number: number (1..12) }
 * Met à jour l’UE d’un cours existant.
 * Réponses:
 *  - 200 { course: { id, ue_number, title, created_at } }
 *  - 404 { error: 'Cours introuvable.' }
 */
router.patch('/courses/:id/transfer', async (req, res) => {
  try {
    const { id } = req.params || {};
    const { ue_number } = req.body || {};

    if (!isUuid(id)) return res.status(400).json({ error: 'ID invalide.' });
    const ue = Number(ue_number);
    if (!Number.isInteger(ue) || ue < 1 || ue > 12) {
      return res.status(400).json({ error: 'ue_number doit être un entier entre 1 et 12.' });
    }

    const { data, error } = await supabase
      .from('courses')
      .update({ ue_number: ue })
      .eq('id', id)
      .select('id, ue_number, title, created_at')
      .single();

    if (error) {
      // Si la ligne n’existe pas, Supabase ne met rien à jour
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Cours introuvable.' });
      }
      console.error('Supabase transfer UE error:', error);
      return res.status(500).json({ error: 'Erreur transfert UE.' });
    }

    if (!data) return res.status(404).json({ error: 'Cours introuvable.' });

    res.json({ course: data });
  } catch (e) {
    console.error('PATCH /courses/:id/transfer error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
