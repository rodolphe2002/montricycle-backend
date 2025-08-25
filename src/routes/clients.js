import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';

const router = Router();

// ============ ADMIN endpoints ============
// List clients
router.get('/admin/list', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const clients = await User.find({ role: 'client' })
      .select('name phone clientStatus createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ clients: clients.map(c => ({
      id: String(c._id),
      name: c.name,
      phone: c.phone,
      clientStatus: c.clientStatus || 'active',
    })) });
  } catch (err) {
    console.error('Admin list clients error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Toggle client status between active <-> suspended
router.post('/admin/:id/toggle', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const user = await User.findOne({ _id: id, role: 'client' }).select('clientStatus');
    if (!user) return res.status(404).json({ error: 'Client introuvable' });
    const next = (user.clientStatus || 'active') === 'active' ? 'suspended' : 'active';
    user.clientStatus = next;
    await user.save();
    return res.json({ id, clientStatus: user.clientStatus });
  } catch (err) {
    console.error('Admin toggle client error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
