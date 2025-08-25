import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import Promo from '../models/Promo.js';

const router = Router();

// List promos (admin)
router.get('/admin/list', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const promos = await Promo.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ promos: promos.map(p => ({
      id: String(p._id),
      code: p.code,
      type: p.type,
      value: p.value,
      active: !!p.active,
      createdAt: p.createdAt,
    }))});
  } catch (err) {
    console.error('List promos error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Create promo (admin)
router.post('/admin', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const { code, type = 'percent', value, active = true } = req.body || {};
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Code requis' });
    const t = type === 'amount' ? 'amount' : 'percent';
    const v = Number(value);
    if (!(v >= 0)) return res.status(400).json({ error: 'Valeur invalide' });
    const created = await Promo.create({ code: code.trim().toUpperCase(), type: t, value: v, active: !!active });
    return res.status(201).json({ id: String(created._id) });
  } catch (err) {
    if (String(err?.code) === '11000') return res.status(409).json({ error: 'Code déjà existant' });
    console.error('Create promo error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Toggle promo active (admin)
router.post('/admin/:id/toggle', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const p = await Promo.findById(id);
    if (!p) return res.status(404).json({ error: 'Promo introuvable' });
    p.active = !p.active;
    await p.save();
    return res.json({ active: p.active });
  } catch (err) {
    console.error('Toggle promo error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Delete promo (admin)
router.delete('/admin/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const r = await Promo.deleteOne({ _id: id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Promo introuvable' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete promo error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
