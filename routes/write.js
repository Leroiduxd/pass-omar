// routes/write.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

// POST /api/courses  — créer un cours (on stocke dans raw_content)
router.post('/courses', async (req, res) => {
  try {
    const { ue_number, title, content } = req.body;

    if (
      typeof ue_number !== 'number' ||
      ue_number < 1 || ue_number > 12 ||
      !title || !content
    ) {
      return res.status(400).json({ error: 'Champs invalides: ue_number(1-12), title, content requis.' });
    }

    const { data, error } = await supabase
      .from('courses')
      .insert([{ ue_number, title, raw_content: content }])
      .select('id, ue_number, title, created_at')
      .single();

    if (error) throw error;

    res.status(201).json({ course: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

