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
    if (!username || String(username).trim().length < 3) return res.status(400).json({ error: 'Nom d\'utilisateur invalide (min 3)' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    const existing = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Nom d\'utilisateur déjà pris' });

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

    // Validation du nom complet (au moins 2 mots, uniquement des lettres, min 2 caractères par mot)
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: "Ce n'est pas un format correct de nom complet" });
    }
    
    const nameWords = name.trim().split(/\s+/);
    if (nameWords.length < 2) {
      return res.status(400).json({ error: "Ce n'est pas un format correct de nom complet" });
    }
    
    // Vérifier chaque mot du nom
    for (const word of nameWords) {
      if (!/^[a-zA-ZÀ-ÿ]+$/.test(word)) {
        return res.status(400).json({ error: "Ce n'est pas un format correct de nom complet" });
      }
      if (word.length < 2) {
        return res.status(400).json({ error: "Ce n'est pas un format correct de nom complet" });
      }
    }

    // Validation de l'email (format standard)
    if (email && typeof email === 'string' && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: "votre mail n'est pas correcte" });
      }
    }

    // Validation du téléphone (uniquement +225, 10 chiffres)
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: "votre numéro est incorrect" });
    }
    
    // Nettoyer et formater le numéro de téléphone
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: "votre numéro est incorrect" });
    }
    
    // Vérifier que le numéro commence par les indicatifs ivoiriens courants
    const ivoirePrefixes = ['07', '05', '01', '04', '25', '27', '20', '21', '22', '23', '24', '26', '28', '29'];
    const prefix = cleanPhone.substring(0, 2);
    if (!ivoirePrefixes.includes(prefix)) {
      return res.status(400).json({ error: "votre numéro est incorrect" });
    }

    // Validation du mot de passe (3 critères cruciaux: 8 caractères, minuscule, majuscule)
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: "votre mot de passe est incorrect" });
    }
    
    const hasMinLength = password.length >= 8;
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    
    if (!hasMinLength || !hasLowercase || !hasUppercase) {
      return res.status(400).json({ error: "votre mot de passe est incorrect" });
    }

    // Uniqueness
    const existing = await User.findOne({ phone: `+225 ${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 7)} ${cleanPhone.slice(7, 10)}` });
    if (existing) return res.status(409).json({ error: 'Téléphone déjà enregistré' });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Formater le numéro de téléphone
    const formattedPhone = `+225 ${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 7)} ${cleanPhone.slice(7, 10)}`;

    const user = await User.create({
      role: 'client',
      name: name.trim(),
      phone: formattedPhone,
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
// Body: { phone, password } — connexion par numéro de téléphone uniquement
router.post('/login', async (req, res) => {
  try {
    const { identifier, phone, password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
    const raw = (identifier ?? phone ?? '').trim();

    // Phone-only login: normalize to digits, strip optional country code (225 / 00225)
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00225')) digits = digits.slice(5);
    else if (digits.length > 10 && digits.startsWith('225')) digits = digits.slice(3);
    if (!digits) return res.status(400).json({ error: 'Numéro de téléphone requis' });

    // Match stored phones regardless of formatting: optional non-digits between
    // digits, optional leading country code in the stored value.
    const digitsPattern = digits
      .split('')
      .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\D*');
    const rx = new RegExp('^\\D*(?:(?:00)?225)?\\D*' + digitsPattern + '\\D*$');
    const user = await User.findOne({ phone: { $regex: rx } });
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
