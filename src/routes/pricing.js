import { Router } from 'express';
import Pricing from '../models/Pricing.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

async function getOrCreatePricing() {
  let p = await Pricing.findOne();
  if (!p) {
    p = await Pricing.create({});
  }
  return p;
}

// Public: get current pricing (for clients/app)
router.get('/public', async (_req, res) => {
  try {
    const p = await getOrCreatePricing();
    return res.json({
      base: p.base,
      perKm: p.perKm,
      perMin: p.perMin,
      peakEnabled: !!p.peakEnabled,
      peakMultiplier: p.peakMultiplier,
      updatedAt: p.updatedAt,
    });
  } catch (err) {
    console.error('Get public pricing error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Admin: get current pricing
router.get('/admin', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const p = await getOrCreatePricing();
    return res.json({
      id: String(p._id),
      base: p.base,
      perKm: p.perKm,
      perMin: p.perMin,
      peakEnabled: !!p.peakEnabled,
      peakMultiplier: p.peakMultiplier,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  } catch (err) {
    console.error('Get admin pricing error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Admin: update pricing
router.put('/admin', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const { base, perKm, perMin, peakEnabled, peakMultiplier } = req.body || {};
    const p = await getOrCreatePricing();

    if (Number.isFinite(Number(base))) p.base = Number(base);
    if (Number.isFinite(Number(perKm))) p.perKm = Number(perKm);
    if (Number.isFinite(Number(perMin))) p.perMin = Number(perMin);
    if (typeof peakEnabled === 'boolean') p.peakEnabled = peakEnabled;
    if (Number.isFinite(Number(peakMultiplier))) p.peakMultiplier = Number(peakMultiplier);

    await p.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('Update pricing error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
