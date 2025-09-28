// routes/read.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

// GET /api/ues — liste des UEs (distinct)
router.get('/ues', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('ue_number');

    if (error) throw error;

    // distinct côté app (simple, efficace pour MVP)
    const ues = [...new Set((data || []).map(r => r.ue_number))].sort((a, b) => a - b);
    res.json({ ues });
  } catch (e) {
    console.error('GET /ues error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/ues/:ueNumber/courses — liste des cours d'une UE
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
    console.error('GET /ues/:ueNumber/courses error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/courses/:id — contenu d'un cours
router.get('/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('courses')
      .select('id, ue_number, title, content, created_at')
      .eq('id', id)
      .single();

    if (error?.code === 'PGRST116' || error?.message?.includes('No rows')) {
      return res.status(404).json({ error: 'Cours introuvable.' });
    }
    if (error) throw error;

    res.json({ course: data });
  } catch (e) {
    console.error('GET /courses/:id error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
