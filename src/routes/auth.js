import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';

const router = Router();

// Rate limiter for auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

// GET /api/auth/admin/exists
router.get('/admin/exists', async (_req, res) => {
  try {
    const count = await User.countDocuments({ role: 'admin' });
    return res.json({ exists: count > 0 });
  } catch (err) {
    console.error('Admin exists error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/admin/register
// Body: { username, password, name? }
// Only allowed if no admin exists yet
router.post('/admin/register', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: 'admin' });
    if (count > 0) return res.status(403).json({ error: 'Admin déjà existant' });
    const { username, password, name } = req.body || {};
    if (!username || String(username).trim().length < 3) return res.status(400).json({ error: 'Nom d’utilisateur invalide (min 3)' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    const existing = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Nom d’utilisateur déjà pris' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(String(password), salt);
    const user = await User.create({
      role: 'admin',
      name: (name && String(name).trim()) || 'Admin',
      phone: 'admin',
      username: String(username).trim().toLowerCase(),
      passwordHash,
    });
    const token = jwt.sign(
      { sub: String(user._id), role: user.role },
      process.env.JWT_SECRET || 'dev_secret_change_me',
      { expiresIn: '7d' }
    );
    return res.status(201).json({ message: 'Admin créé avec succès', id: user._id, name: user.name, role: user.role, token });
  } catch (err) {
    console.error('Admin register error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/admin/login
// Body: { username, password }
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });
    const user = await User.findOne({ username: String(username).trim().toLowerCase(), role: 'admin' });
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
    const token = jwt.sign(
      { sub: String(user._id), role: user.role },
      process.env.JWT_SECRET || 'dev_secret_change_me',
      { expiresIn: '7d' }
    );
    return res.json({ id: user._id, name: user.name, role: user.role, token });
  } catch (err) {
    console.error('Admin login error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});
router.use(authLimiter);

// POST /api/auth/register
// Body: { name, phone, password, email?, district? }
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, email, district } = req.body || {};

    // Basic validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Nom invalide' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    }
    if (!phone || typeof phone !== 'string' || !/[0-9+\s-]{7,}/.test(phone)) {
      return res.status(400).json({ error: 'Téléphone invalide' });
    }

    // Uniqueness
    const existing = await User.findOne({ phone });
    if (existing) return res.status(409).json({ error: 'Téléphone déjà enregistré' });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      role: 'client',
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim()?.toLowerCase() || undefined,
      district: district?.trim() || undefined,
      passwordHash,
    });

    // Issue JWT
    const token = jwt.sign(
      { sub: String(user._id), role: user.role },
      process.env.JWT_SECRET || 'dev_secret_change_me',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      id: user._id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      district: user.district || null,
      createdAt: user.createdAt,
      token,
    });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login
// Body: { phone, password }
router.post('/login', async (req, res) => {
  try {
    const { identifier, phone, password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
    const raw = (identifier ?? phone ?? '').trim();
    if (!raw) return res.status(400).json({ error: 'Téléphone ou email requis' });

    // Accept phone OR email, be lenient on phone formatting (spaces/dashes)
    const isEmail = raw.includes('@');
    let user;
    if (isEmail) {
      user = await User.findOne({ email: raw.toLowerCase() });
    } else {
      const phoneDigits = raw.replace(/\D/g, '');
      // Build a regex that allows any non-digit chars between the digits
      const optionalNonDigitsPattern = phoneDigits
        .split('')
        .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\D*');
      const rx = new RegExp('^\\D*' + optionalNonDigitsPattern + '\\D*$');
      user = await User.findOne({ $or: [ { phone: raw }, { phone: { $regex: rx } } ] });
    }
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

    // Enforce KYC approval for drivers before login
    if (user.role === 'driver' && user.kycStatus !== 'approved') {
      return res.status(403).json({ error: 'Votre compte conducteur est en attente de validation par un administrateur.' });
    }

    const token = jwt.sign(
      { sub: String(user._id), role: user.role },
      process.env.JWT_SECRET || 'dev_secret_change_me',
      { expiresIn: '7d' }
    );

    return res.json({
      id: user._id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      district: user.district || null,
      createdAt: user.createdAt,
      token,
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
 
// POST /api/auth/create-admin
// Body: { name, phone, password, email? }
// Header: X-Setup-Token: <ADMIN_SETUP_TOKEN>
// Purpose: bootstrap an admin in dev/staging. Protects creation via a setup token.
router.post('/create-admin', async (req, res) => {
  try {
    const setupHeader = req.header('X-Setup-Token') || '';
    const setupToken = process.env.ADMIN_SETUP_TOKEN || 'dev_admin_setup_token_change_me';
    if (!setupHeader || setupHeader !== setupToken) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { name, phone, password, email } = req.body || {};
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Nom invalide' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    if (!phone || !/[0-9+\s-]{7,}/.test(String(phone))) return res.status(400).json({ error: 'Téléphone invalide' });

    const existing = await User.findOne({ phone: String(phone).trim() });
    if (existing) return res.status(409).json({ error: 'Téléphone déjà enregistré' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(String(password), salt);

    const user = await User.create({
      role: 'admin',
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: email?.trim()?.toLowerCase() || undefined,
      passwordHash,
    });

    const token = jwt.sign(
      { sub: String(user._id), role: user.role },
      process.env.JWT_SECRET || 'dev_secret_change_me',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      id: user._id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      token,
    });
  } catch (err) {
    console.error('Create admin error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});
