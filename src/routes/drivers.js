import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';

const router = Router();

// Get my driver presence status
router.get('/me/status', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const user = await User.findById(req.user.id).select('online lastSeenAt').lean();
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.json({ online: !!user.online, lastSeenAt: user.lastSeenAt || null });
  } catch (err) {
    console.error('Get driver status error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Update my driver presence status
router.post('/me/status', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const { online } = req.body || {};
    const update = { online: !!online };
    if (!online) update.lastSeenAt = new Date();
    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true, select: 'online lastSeenAt' });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.json({ online: !!user.online, lastSeenAt: user.lastSeenAt || null });
  } catch (err) {
    console.error('Set driver status error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Heartbeat to update lastSeenAt without going offline
router.post('/me/heartbeat', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    await User.findByIdAndUpdate(req.user.id, { lastSeenAt: new Date() });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Driver heartbeat error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Update my live location
router.post('/me/location', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const { lat, lon, acc } = req.body || {};
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'lat/lon requis (number)' });
    }
    const update = {
      currentLat: lat,
      currentLon: lon,
      currentAcc: typeof acc === 'number' ? acc : undefined,
      lastSeenAt: new Date(),
    };
    await User.findByIdAndUpdate(req.user.id, update);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Driver location update error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Public fetch of a driver's last known location (auth required)
router.get('/:id/location', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const user = await User.findOne({ _id: id, role: 'driver' })
      .select('currentLat currentLon currentAcc lastSeenAt online name phone plate rating')
      .lean();
    if (!user) return res.status(404).json({ error: 'Conducteur introuvable' });
    return res.json({
      id,
      name: user.name,
      phone: user.phone,
      plate: user.plate || null,
      rating: user.rating ?? null,
      online: !!user.online,
      lastSeenAt: user.lastSeenAt || null,
      location: (typeof user.currentLat === 'number' && typeof user.currentLon === 'number')
        ? { lat: user.currentLat, lon: user.currentLon, acc: user.currentAcc ?? null }
        : null,
    });
  } catch (err) {
    console.error('Get driver location error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
 
// ============ ADMIN endpoints ============
// List drivers (optionally filter by driverStatus)
router.get('/admin/list', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const { status } = req.query || {};
    const query = { role: 'driver' };
    if (status && ['active', 'suspended', 'banned'].includes(String(status))) {
      query.driverStatus = String(status);
    }
    const drivers = await User.find(query)
      .select('name phone rating driverStatus kycStatus online lastSeenAt plate createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ drivers: drivers.map(d => ({
      id: String(d._id),
      name: d.name,
      phone: d.phone,
      rating: d.rating ?? null,
      driverStatus: d.driverStatus || 'active',
      kycStatus: d.kycStatus,
      online: !!d.online,
      lastSeenAt: d.lastSeenAt || null,
      plate: d.plate || null,
    })) });
  } catch (err) {
    console.error('Admin list drivers error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Toggle driver status between active <-> suspended
router.post('/admin/:id/toggle', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const user = await User.findOne({ _id: id, role: 'driver' }).select('driverStatus');
    if (!user) return res.status(404).json({ error: 'Conducteur introuvable' });
    if (user.driverStatus === 'banned') return res.status(400).json({ error: 'Conducteur banni' });
    const next = user.driverStatus === 'active' ? 'suspended' : 'active';
    user.driverStatus = next;
    await user.save();
    return res.json({ id, driverStatus: user.driverStatus });
  } catch (err) {
    console.error('Admin toggle driver error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Ban a driver
router.post('/admin/:id/ban', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const user = await User.findOneAndUpdate({ _id: id, role: 'driver' }, { driverStatus: 'banned' }, { new: true }).select('driverStatus');
    if (!user) return res.status(404).json({ error: 'Conducteur introuvable' });
    return res.json({ id, driverStatus: user.driverStatus });
  } catch (err) {
    console.error('Admin ban driver error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});
