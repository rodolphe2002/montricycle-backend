import { Router } from 'express';
import ShareToken from '../models/ShareToken.js';
import Order from '../models/Order.js';

const router = Router();

// Resolve a share token to a suggested frontend path
router.get('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token requis' });
    const entry = await ShareToken.findOne({ token }).lean();
    if (!entry) return res.status(404).json({ error: 'Lien introuvable', expired: true });
    if (entry.revoked) return res.status(410).json({ error: 'Lien expiré', expired: true });

    const order = await Order.findById(entry.order).lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable', expired: true });

    const id = String(order._id);
    const status = order.status;

    if (status === 'assigned') {
      return res.json({ ok: true, orderId: id, status, redirectTo: `/commande-acceptee?id=${encodeURIComponent(id)}` });
    }
    if (status === 'in_progress') {
      return res.json({ ok: true, orderId: id, status, redirectTo: `/trajet-en-cours?id=${encodeURIComponent(id)}` });
    }
    // any other state considered expired for sharing
    return res.status(410).json({ error: 'Suivi indisponible', expired: true });
  } catch (err) {
    console.error('Resolve share token error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
