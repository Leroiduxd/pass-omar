// routes/read.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

// GET /api/ues
router.get('/ues', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('ue_number');
    if (error) throw error;
    const ues = [...new Set((data || []).map(r => r.ue_number))].sort((a, b) => a - b);
    res.json({ ues });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/ues/:ueNumber/courses
router.get('/ues/:ueNumber/courses', async (req, res) => {
  try {
    const ueNumber = Number(req.params.ueNumber);
    if (!Number.isInteger(ueNumber) || ueNumber < 1 || ueNumber > 12) {
      return res.status(400).json({ error: 'ueNumber doit être un entier entre 1 et 12.' });
    }
    const { data, error } = await supabase
      .from('courses')
      .select('id, title, created_at')
      .eq('ue_number', ueNumber)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ courses: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/courses/:id  — retourne brut + amélioré
router.get('/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('courses')
      .select('id, ue_number, title, raw_content, refined_content, created_at')
      .eq('id', id)
      .single();

    if (error?.code === 'PGRST116') return res.status(404).json({ error: 'Cours introuvable.' });
    if (error) throw error;

    res.json({ course: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
