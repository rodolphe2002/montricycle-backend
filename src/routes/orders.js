import { Router } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import ShareToken from '../models/ShareToken.js';
import crypto from 'crypto';
import Driver from '../models/Driver.js';
import { requireAuth } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import Promo from '../models/Promo.js';

const router = Router();

// In-memory list of SSE clients (drivers)
const sseClients = new Set(); // each item: { res, driverId }

function broadcastOrderAssigned(orderId) {
  const payload = JSON.stringify({ orderId: String(orderId) });
  const msg = `event: order_assigned\ndata: ${payload}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(msg); } catch {}
  }
}

// Notify the assigned driver that an order has been cancelled
function broadcastOrderCancelled(orderId, driverId, reason) {
  const payload = JSON.stringify({ orderId: String(orderId), driverId: String(driverId), reason: String(reason || '') });
  const msg = `event: order_cancelled\ndata: ${payload}\n\n`;
  for (const client of sseClients) {
    if (!client?.driverId) continue;
    if (String(client.driverId) !== String(driverId)) continue;
    try { client.res.write(msg); } catch {}
  }
}

// Finalize a completed order: save tip, payment, and receipt preferences (client only)
router.post('/:id/finalize', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Réservé aux clients' });
    const id = req.params.id;
    const { tip, paymentMethod, receiptRequested, receiptEmail } = req.body || {};
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (String(order.user) !== String(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    if (order.status !== 'completed') return res.status(409).json({ error: 'La course doit être terminée' });

    if (typeof tip === 'number' && tip >= 0) order.tip = Math.round(tip);
    if (typeof paymentMethod === 'string') order.paymentMethod = paymentMethod;
    if (receiptRequested === 'email' || receiptRequested === 'pdf' || receiptRequested === null) {
      order.receiptRequested = receiptRequested ?? null;
    }
    if (typeof receiptEmail === 'string') order.receiptEmail = receiptEmail;
    order.finalizedAt = order.finalizedAt || new Date();

    await order.save();
    try { await ShareToken.updateMany({ order: order._id, revoked: false }, { $set: { revoked: true, expiresAt: new Date() } }); } catch {}
    return res.json({ ok: true });
  } catch (err) {
    console.error('Finalize order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Driver: get current active order (assigned or in_progress)
router.get('/driver/active', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const driverId = req.user.id;
    const order = await Order.findOne({ driver: driverId, status: { $in: ['assigned', 'in_progress'] } })
      .sort({ startedAt: -1, acceptedAt: -1, createdAt: -1 })
      .select({
        _id: 1,
        status: 1,
        start: 1,
        destination: 1,
        passengers: 1,
        bags: 1,
        bagOffer: 1,
        priceEstimate: 1,
        acceptedAt: 1,
        startedAt: 1,
      })
      .lean();
    if (!order) return res.json({ order: null });
    return res.json({
      order: {
        id: String(order._id),
        _id: String(order._id),
        status: order.status,
        start: order.start || null,
        destination: order.destination || null,
        passengers: order.passengers ?? null,
        bags: order.bags ?? 0,
        bagOffer: order.bagOffer ?? 0,
        priceEstimate: order.priceEstimate ?? null,
        acceptedAt: order.acceptedAt || null,
        startedAt: order.startedAt || null,
      }
    });
  } catch (err) {
    console.error('Driver active order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List cancelled orders (Litiges & Annulations)
router.get('/admin/cancelled', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const { limit } = req.query || {};
    const lim = Math.max(1, Math.min(200, Number(limit) || 100));

    const orders = await Order.find({ status: 'cancelled' })
      .populate('user', 'name phone')
      .populate('driver', 'name phone')
      .sort({ cancelledAt: -1, updatedAt: -1, createdAt: -1 })
      .limit(lim)
      .lean();

    const rows = (orders || []).map((o) => {
      const idHex = String(o._id);
      const tail2Dec = parseInt(idHex.slice(-2), 16);
      const disputeId = `D-${isNaN(tail2Dec) ? '00' : tail2Dec}`; // e.g., D-21
      const orderShort = `#${idHex.slice(-4).toUpperCase()}`; // e.g., #12A4
      const motif = o.cancelReason || o.cancellation?.reason || 'Annulation';
      let action = o.cancellation?.action || null;
      if (!action) action = o.cancellation?.feesApplied ? 'Frais appliqués' : 'Aucune action';
      const statut = o.cancellation?.disputeStatus || 'open';
      const trajet = {
        start: o.start?.name || null,
        destination: o.destination?.name || null,
      };
      return {
        id: String(o._id),
        disputeId,      // e.g., D-21
        orderShort,     // e.g., #12A4
        motif,
        action,
        statut,         // 'open' | 'closed' | 'none'
        cancelledAt: o.cancelledAt || o.updatedAt || o.createdAt,
        trajet,
        client: o.user ? { name: o.user.name, phone: o.user.phone } : null,
        driver: o.driver ? { name: o.driver.name, phone: o.driver.phone } : null,
      };
    });

    return res.json({ disputes: rows });
  } catch (err) {
    console.error('Admin list cancelled orders error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Apply a promo code to an order (admin)
router.post('/admin/:id/apply-promo', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const code = String((req.body?.code || '')).trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code requis' });

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const promo = await Promo.findOne({ code });
    if (!promo) return res.status(404).json({ error: 'Code promo introuvable' });
    if (!promo.active) return res.status(409).json({ error: 'Code promo inactif' });

    const baseAmount = typeof order.priceEstimate === 'number' ? order.priceEstimate : 0;
    let discount = 0;
    if (promo.type === 'percent') {
      discount = Math.round((baseAmount * Math.min(Math.max(promo.value, 0), 100)) / 100);
    } else {
      discount = Math.max(0, Math.round(promo.value));
    }
    const newAmount = Math.max(0, baseAmount - discount);

    order.promoCode = code;
    if (baseAmount > 0) order.priceEstimate = newAmount;
    await order.save();

    return res.json({
      ok: true,
      orderId: String(order._id),
      promo: { code: promo.code, type: promo.type, value: promo.value },
      amountBefore: baseAmount,
      discount,
      amountAfter: typeof order.priceEstimate === 'number' ? order.priceEstimate : baseAmount,
    });
  } catch (err) {
    console.error('Admin apply promo error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List payments (derived from orders)
router.get('/admin/payments', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const { limit } = req.query || {};
    const lim = Math.max(1, Math.min(200, Number(limit) || 100));
    const orders = await Order.find({
      $or: [
        { finalizedAt: { $ne: null } },
        { paymentMethod: { $exists: true, $ne: null } },
      ],
    })
      .sort({ finalizedAt: -1, createdAt: -1 })
      .limit(lim)
      .select({ _id: 1, status: 1, priceEstimate: 1, finalizedAt: 1, paymentMethod: 1, createdAt: 1 })
      .lean();

    const payments = (orders || []).map((o) => {
      const idHex = String(o._id);
      const tail = idHex.slice(-3).toUpperCase();
      const paymentId = `P-${tail}`; // ex: P-874
      let status = 'pending';
      if (o.status === 'completed' && o.finalizedAt) status = 'success';
      else if (o.status === 'cancelled' && o.finalizedAt) status = 'refunded';
      return {
        paymentId,
        orderId: String(o._id),
        method: o.paymentMethod || null,
        amount: typeof o.priceEstimate === 'number' ? o.priceEstimate : 0,
        status,
        createdAt: o.createdAt || null,
        finalizedAt: o.finalizedAt || null,
      };
    });

    return res.json({ payments });
  } catch (err) {
    console.error('Admin list payments error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Rate a completed ride (client only)
router.post('/:id/rate', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Réservé aux clients' });
    const id = req.params.id;
    const { rating, review } = req.body || {};
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (String(order.user) !== String(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    if (order.status !== 'completed') return res.status(409).json({ error: 'La course doit être terminée pour être notée' });
    const r = Number(rating);
    if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'Note invalide (1-5)' });

    order.rating = r;
    order.review = typeof review === 'string' ? review.trim() : undefined;
    await order.save();

    // Recompute driver's average rating from completed orders with rating
    if (order.driver) {
      const [agg] = await Order.aggregate([
        { $match: { driver: order.driver, status: 'completed', rating: { $gte: 1 } } },
        { $group: { _id: '$driver', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      const avg = agg?.avgRating ? Math.round(agg.avgRating * 10) / 10 : r;
      try { await Driver.updateOne({ _id: order.driver }, { $set: { rating: avg } }); } catch {}
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Rate order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Create an order
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      start,
      destination,
      passengers,
      bags,
      bagOffer,
      bagDescription,
      accessible,
      promoCode,
      priceEstimate,
    } = req.body || {};

    // Basic validation
    const validPoint = (p) => p && typeof p.lat === 'number' && typeof p.lon === 'number';
    if (!validPoint(start) || !validPoint(destination)) {
      return res.status(400).json({ error: 'Points invalides (start/destination requis avec lat/lon)' });
    }
    // Clamp pax and bags to model constraints to avoid validation errors
    const paxNum = Number(passengers);
    const pax = Math.max(1, Math.min(3, Number.isFinite(paxNum) ? paxNum : 1));
    const bagsNum = Number(bags);
    const bagsClamped = Math.max(0, Math.min(3, Number.isFinite(bagsNum) ? bagsNum : 0));

    const order = await Order.create({
      user: req.user.id,
      start,
      destination,
      passengers: pax,
      bags: bagsClamped,
      bagOffer: Math.max(0, Number(bagOffer) || 0),
      bagDescription: typeof bagDescription === 'string' ? bagDescription.trim() : undefined,
      accessible: !!accessible,
      promoCode: promoCode?.trim() || undefined,
      priceEstimate: Number(priceEstimate) || undefined,
    });

    return res.status(201).json({ id: order._id, status: order.status, createdAt: order.createdAt });
  } catch (err) {
    console.error('Create order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// SSE stream for drivers to receive real-time order updates
router.get('/stream', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
    if (!payload || payload.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    // initial comment to establish
    res.write(`: connected\n\n`);

    const client = { res, driverId: String(payload.sub) };
    sseClients.add(client);

    req.on('close', () => {
      try { sseClients.delete(client); } catch {}
    });
  } catch (err) {
    return res.status(401).json({ error: 'Jeton invalide' });
  }
});

// (moved) generic GET('/:id') route is placed at the end of this file

// Start a ride (assigned -> in_progress)
router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const id = req.params.id;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (String(order.driver) !== String(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    if (order.status !== 'assigned') return res.status(409).json({ error: 'La course ne peut pas démarrer' });
    order.status = 'in_progress';
    order.startedAt = new Date();
    await order.save();
    const populated = await Order.findById(order._id).populate('user', 'name phone').lean();
    return res.json({
      id: String(populated._id),
      status: populated.status,
      startedAt: populated.startedAt,
      client: populated.user ? { name: populated.user.name, phone: populated.user.phone } : null,
    });
  } catch (err) {
    console.error('Start order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Complete a ride (in_progress -> completed)
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const id = req.params.id;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (String(order.driver) !== String(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    if (order.status !== 'in_progress') return res.status(409).json({ error: 'La course ne peut pas être terminée' });
    order.status = 'completed';
    order.completedAt = new Date();
    await order.save();
    // Revoke any active share tokens upon completion
    try { await ShareToken.updateMany({ order: order._id, revoked: false }, { $set: { revoked: true, expiresAt: new Date() } }); } catch {}
    const populated = await Order.findById(order._id).populate('user', 'name phone').lean();
    return res.json({
      id: String(populated._id),
      status: populated.status,
      completedAt: populated.completedAt,
      client: populated.user ? { name: populated.user.name, phone: populated.user.phone } : null,
    });
  } catch (err) {
    console.error('Complete order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List available (pending) orders for drivers
router.get('/available', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const rows = await Order.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(50)
      .select({
        start: 1,
        destination: 1,
        passengers: 1,
        bags: 1,
        bagOffer: 1,
        bagDescription: 1,
        priceEstimate: 1,
        createdAt: 1,
        status: 1,
      })
      .lean();
    return res.json({
      orders: rows.map(o => ({
        id: String(o._id),
        start: o.start || null,
        destination: o.destination || null,
        passengers: typeof o.passengers === 'number' ? o.passengers : null,
        bags: typeof o.bags === 'number' ? o.bags : 0,
        bagOffer: typeof o.bagOffer === 'number' ? o.bagOffer : 0,
        bagDescription: o.bagDescription || '',
        priceEstimate: typeof o.priceEstimate === 'number' ? o.priceEstimate : null,
        createdAt: o.createdAt || null,
        status: o.status,
      }))
    });
  } catch (err) {
    console.error('List available orders error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============ ADMIN endpoints ============
// List orders with client and driver info
router.get('/admin/list', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const { status, limit } = req.query || {};
    const q = {};
    if (status && ['pending','assigned','in_progress','completed','cancelled'].includes(String(status))) {
      q.status = String(status);
    }
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const orders = await Order.find(q)
      .populate('user', 'name phone')
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();
    return res.json({
      orders: orders.map(o => ({
        id: String(o._id),
        status: o.status,
        start: o.start,
        destination: o.destination,
        priceEstimate: o.priceEstimate ?? null,
        createdAt: o.createdAt,
        acceptedAt: o.acceptedAt || null,
        startedAt: o.startedAt || null,
        completedAt: o.completedAt || null,
        client: o.user ? { id: String(o.user._id), name: o.user.name, phone: o.user.phone } : null,
        driver: o.driver ? { id: String(o.driver._id), name: o.driver.name, phone: o.driver.phone } : null,
      }))
    });
  } catch (err) {
    console.error('Admin list orders error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============ CLIENT endpoints ============

// Create or return a share token for an order (client only)
router.post('/:id/share', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Réservé aux clients' });
    const id = req.params.id;
    const order = await Order.findById(id).select({ status: 1, user: 1 }).lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (String(order.user) !== String(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });
    if (!['assigned','in_progress'].includes(order.status)) {
      return res.status(409).json({ error: 'Le partage est disponible uniquement pour les courses en cours' });
    }

    // Try reuse a non-revoked token
    let entry = await ShareToken.findOne({ order: id, revoked: false }).lean();
    if (!entry) {
      const token = crypto.randomBytes(24).toString('hex');
      const created = await ShareToken.create({ token, order: id, createdBy: req.user.id, expiresAt: null, revoked: false });
      entry = created.toObject();
    }

    const base = process.env.FRONTEND_BASE?.replace(/\/$/, '') || 'http://localhost:3000';
    const url = `${base}/suivi/${entry.token}`;
    return res.status(201).json({ ok: true, token: entry.token, url });
  } catch (err) {
    console.error('Create share token error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});
// List recent orders for the authenticated client (for 'pre-commande' recents)
router.get('/client/recent', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Réservé aux clients' });
    const lim = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const orders = await Order.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(lim)
      .select({ start: 1, destination: 1, status: 1, createdAt: 1, completedAt: 1 })
      .lean();
    return res.json({ orders: orders.map(o => ({
      id: String(o._id),
      start: o.start || null,
      destination: o.destination || null,
      status: o.status,
      createdAt: o.createdAt,
      completedAt: o.completedAt || null,
    })) });
  } catch (err) {
    console.error('Client recent orders error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Driver statistics (trips and revenue)
router.get('/driver/stats', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });

    const driverId = req.user.id;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dayAgg] = await Order.aggregate([
      { $match: { driver: new mongoose.Types.ObjectId(driverId), status: 'completed', completedAt: { $gte: startOfDay } } },
      { $group: { _id: null, trips: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$priceEstimate', 0] } } } },
    ]);

    const [monthAgg] = await Order.aggregate([
      { $match: { driver: new mongoose.Types.ObjectId(driverId), status: 'completed', completedAt: { $gte: startOfMonth } } },
      { $group: { _id: null, trips: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$priceEstimate', 0] } } } },
    ]);

    // Simple accept rate proxy: accepted in last 30 days
    const last30 = new Date(now.getTime() - 30*24*3600*1000);
    const acceptCount = await Order.countDocuments({ driver: driverId, completedAt: { $gte: last30 } });

    return res.json({
      dayTrips: dayAgg?.trips || 0,
      dayRevenue: dayAgg?.revenue || 0,
      monthTrips: monthAgg?.trips || 0,
      monthRevenue: monthAgg?.revenue || 0,
      acceptRate: Math.min(100, Math.round((acceptCount / Math.max(acceptCount, 1)) * 100)), // placeholder 100% if any
    });
  } catch (err) {
    console.error('Driver stats error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Accept an order by ID (driver)
router.post('/:id/accept', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Réservé aux conducteurs' });
    const id = req.params.id;
    const order = await Order.findOne({ _id: id });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (order.status !== 'pending' || order.driver) {
      return res.status(409).json({ error: 'Commande déjà assignée' });
    }
    order.status = 'assigned';
    order.driver = req.user.id;
    order.acceptedAt = new Date();
    await order.save();

    // Return with client and driver info
    const populated = await Order.findById(order._id)
      .populate('user', 'name phone')
      .populate('driver', 'name phone plate rating online')
      .lean();

    // Notify all connected drivers to remove this order from their available queues
    try { broadcastOrderAssigned(order._id); } catch {}

    return res.json({
      id: String(populated._id),
      status: populated.status,
      start: populated.start,
      destination: populated.destination,
      passengers: populated.passengers,
      bags: populated.bags,
      bagOffer: populated.bagOffer ?? 0,
      bagDescription: populated.bagDescription || null,
      accessible: populated.accessible,
      priceEstimate: populated.priceEstimate,
      client: populated.user ? { name: populated.user.name, phone: populated.user.phone } : null,
      driver: populated.driver ? {
        id: String(populated.driver._id),
        name: populated.driver.name,
        phone: populated.driver.phone,
        plate: populated.driver.plate || null,
        rating: populated.driver.rating ?? null,
        online: !!populated.driver.online,
      } : null,
      acceptedAt: populated.acceptedAt,
    });
  } catch (err) {
    console.error('Accept order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Cancel an order (client or driver)
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { reason } = req.body || {};
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const uid = String(req.user.id);
    const isClient = order.user && String(order.user) === uid;
    const isDriver = order.driver && String(order.driver) === uid;
    const isAdmin = req.user.role === 'admin';
    if (!(isClient || isDriver || isAdmin)) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    if (order.status === 'completed') return res.status(409).json({ error: 'La course est déjà terminée' });
    if (order.status === 'cancelled') return res.json({ ok: true, id: String(order._id), status: order.status });

    // Only allow cancellation if not completed
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellation = {
      by: isAdmin ? 'admin' : (isDriver ? 'driver' : 'client'),
      reason: typeof reason === 'string' ? reason : (order.cancelReason || 'Annulation'),
      feesApplied: false,
      action: null,
      disputeStatus: 'open',
    };
    await order.save();

    // Revoke any active share tokens upon cancellation
    try { await ShareToken.updateMany({ order: order._id, revoked: false }, { $set: { revoked: true, expiresAt: new Date() } }); } catch {}

    // SSE notify the assigned driver, if any
    try {
      if (order.driver) {
        broadcastOrderCancelled(order._id, order.driver, order.cancellation?.reason || 'Annulation');
      }
    } catch {}

    return res.json({ ok: true, id: String(order._id), status: order.status, cancelledAt: order.cancelledAt });
  } catch (err) {
    console.error('Cancel order error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get order details (client, assigned driver, or admin)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const order = await Order.findById(id)
      .populate('user', 'name phone')
      .populate('driver', 'name phone plate rating online')
      .lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const uid = String(req.user.id);
    const isClient = order.user && String(order.user._id) === uid;
    const isDriver = order.driver && String(order.driver._id) === uid;
    if (!(isClient || isDriver || req.user.role === 'admin')) {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    return res.json({
      id: String(order._id),
      status: order.status,
      start: order.start,
      destination: order.destination,
      passengers: order.passengers,
      bags: order.bags,
      bagOffer: order.bagOffer ?? 0,
      bagDescription: order.bagDescription || null,
      priceEstimate: order.priceEstimate || null,
      acceptedAt: order.acceptedAt || null,
      startedAt: order.startedAt || null,
      completedAt: order.completedAt || null,
      rating: order.rating ?? null,
      review: order.review || null,
      client: order.user ? { id: String(order.user._id), name: order.user.name, phone: order.user.phone } : null,
      driver: order.driver ? {
        id: String(order.driver._id),
        name: order.driver.name,
        phone: order.driver.phone,
        plate: order.driver.plate || null,
        rating: order.driver.rating ?? null,
        online: !!order.driver.online,
      } : null,
    });
  } catch (err) {
    console.error('Get order details error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Generate a minimal PDF receipt for the client
router.get('/:id/receipt.pdf', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Réservé aux clients' });
    const id = req.params.id;
    const order = await Order.findById(id)
      .populate('user', 'name phone')
      .populate('driver', 'name phone plate')
      .lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (String(order.user?._id || order.user) !== String(req.user.id)) return res.status(403).json({ error: 'Non autorisé' });

    // Prepare receipt fields
    const total = (Number(order.priceEstimate) || 0) + (Number(order.tip) || 0);
    const lines = [
      `Reçu Tricycle`,
      `Commande: ${String(order._id)}`,
      `Client: ${order.user?.name || ''} (${order.user?.phone || ''})`,
      `Conducteur: ${order.driver?.name || ''} (${order.driver?.phone || ''})`,
      `Départ: ${order.start?.name || ''}`,
      `Arrivée: ${order.destination?.name || ''}`,
      `Passagers: ${order.passengers ?? ''}  Bagages: ${order.bags ?? 0}`,
      `Offre bagages: ${typeof order.bagOffer === 'number' ? order.bagOffer : 0} CFA`,
      `Paiement: ${order.paymentMethod || '—'}`,
      `Montant: ${Number(order.priceEstimate) || 0} CFA`,
      `Pourboire: ${Number(order.tip) || 0} CFA`,
      `Total: ${total} CFA`,
      `Terminé: ${order.completedAt ? new Date(order.completedAt).toLocaleString() : '—'}`,
    ];

    // Minimal PDF (single-page) without external deps
    // Build a simple content stream with lines positioned down the page.
    const contentLines = lines.map((t, i) => `BT /F1 12 Tf 50 ${770 - i * 18} Td (${escapePdfText(t)}) Tj ET`).join('\n');
    const contentStream = `<< /Length ${contentLines.length} >>\nstream\n${contentLines}\nendstream`;
    const objects = [];
    const addObj = (s) => { objects.push(s); return objects.length; };
    const f1 = addObj('<< /Type /Font /Subtype /Type1 /Name /F1 /BaseFont /Helvetica >>');
    const resources = addObj(`<< /Font << /F1 ${f1} 0 R >> >>`);
    const cs = addObj(contentStream);
    const page = addObj(`<< /Type /Page /Parent 4 0 R /Resources ${resources} 0 R /MediaBox [0 0 595 842] /Contents ${cs} 0 R >>`);
    const pages = addObj(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
    const catalog = addObj(`<< /Type /Catalog /Pages ${pages} 0 R >>`);

    let offset = 0;
    const header = '%PDF-1.4\n';
    let body = '';
    const xref = ['xref'];
    const offsets = [0];
    const fmt = (n) => String(n).padStart(10, '0');
    // Assemble objects with byte offsets
    const parts = [header];
    offset += Buffer.byteLength(header);
    objects.forEach((obj, i) => {
      const objStr = `${i + 1} 0 obj\n${obj}\nendobj\n`;
      parts.push(objStr);
      offsets.push(offset);
      offset += Buffer.byteLength(objStr);
    });
    const xrefStart = offset;
    let xrefTable = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xrefTable += `${fmt(offsets[i])} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    parts.push(xrefTable, trailer);
    const pdfBuffer = Buffer.from(parts.join(''));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="recu-tricycle-${String(order._id).slice(-6)}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('Receipt PDF error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

function escapePdfText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');
}

export default router;
