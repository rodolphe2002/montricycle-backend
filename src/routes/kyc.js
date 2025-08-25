import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Configure Cloudinary via env (supports CLOUDINARY_URL or separate vars)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Multer memory storage – we'll push buffers to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

// Helper: upload a file buffer to Cloudinary
function uploadToCloudinary(file, folder = 'tricycle/kyc') {
  return new Promise((resolve, reject) => {
    const opts = {
      folder,
      resource_type: 'image',
      public_id: `${file.fieldname}-${Date.now()}`,
      overwrite: false,
    };
    const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    try {
      stream.end(file.buffer);
    } catch (e) {
      reject(e);
    }
  });
}

// POST /api/kyc/driver
// multipart/form-data: fields(name, phone, password, district, plate) + files(vehiclePhoto, idPhoto, selfie)
router.post('/driver', upload.fields([
  { name: 'vehiclePhoto', maxCount: 1 },
  { name: 'idPhoto', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
]), async (req, res) => {
  try {
    const { name, phone, password, district, plate } = req.body || {};

    // Basic validation
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Nom invalide' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    if (!phone || !/[0-9+\s-]{7,}/.test(String(phone))) return res.status(400).json({ error: 'Téléphone invalide' });
    if (!district || String(district).trim().length < 2) return res.status(400).json({ error: 'Quartier invalide' });
    if (!plate || String(plate).trim().length < 3) return res.status(400).json({ error: 'Immatriculation invalide' });

    const files = req.files || {};
    const v = files.vehiclePhoto?.[0];
    const id = files.idPhoto?.[0];
    const s = files.selfie?.[0];
    if (!v || !id || !s) return res.status(400).json({ error: 'Photos requises' });

    const existing = await User.findOne({ phone: String(phone).trim() });
    if (existing) return res.status(409).json({ error: 'Téléphone déjà enregistré' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(String(password), salt);

    // Upload each image to Cloudinary
    let vehiclePhotoUrl = null;
    let idPhotoUrl = null;
    let selfieUrl = null;
    try {
      const [vRes, idRes, sRes] = await Promise.all([
        uploadToCloudinary(v, 'tricycle/kyc'),
        uploadToCloudinary(id, 'tricycle/kyc'),
        uploadToCloudinary(s, 'tricycle/kyc'),
      ]);
      vehiclePhotoUrl = vRes?.secure_url || vRes?.url || null;
      idPhotoUrl = idRes?.secure_url || idRes?.url || null;
      selfieUrl = sRes?.secure_url || sRes?.url || null;
    } catch (e) {
      console.error('Cloudinary upload error', e);
      return res.status(500).json({ error: "Échec de l'envoi des images" });
    }

    const user = await User.create({
      role: 'driver',
      name: String(name).trim(),
      phone: String(phone).trim(),
      district: String(district).trim(),
      plate: String(plate).trim(),
      passwordHash,
      kycStatus: 'pending',
      vehiclePhotoUrl,
      idPhotoUrl,
      selfieUrl,
    });

    return res.status(201).json({
      message: 'KYC soumis. En attente de validation par un administrateur.',
      id: user._id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      district: user.district || null,
      plate: user.plate || null,
      kycStatus: user.kycStatus,
      vehiclePhotoUrl: user.vehiclePhotoUrl,
      idPhotoUrl: user.idPhotoUrl,
      selfieUrl: user.selfieUrl,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error('KYC driver error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ADMIN: list pending driver KYCs
router.get('/admin/pending', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const users = await User.find({ role: 'driver', kycStatus: 'pending' })
      .select('name phone plate kycStatus vehiclePhotoUrl idPhotoUrl selfieUrl createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ drivers: users.map(u => ({ id: String(u._id), name: u.name, phone: u.phone, plate: u.plate, kycStatus: u.kycStatus, vehiclePhotoUrl: u.vehiclePhotoUrl, idPhotoUrl: u.idPhotoUrl, selfieUrl: u.selfieUrl, createdAt: u.createdAt })) });
  } catch (err) {
    console.error('List pending KYC error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ADMIN: approve a driver KYC
router.post('/admin/:id/approve', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const user = await User.findOneAndUpdate({ _id: id, role: 'driver' }, { kycStatus: 'approved' }, { new: true }).select('name phone plate kycStatus');
    if (!user) return res.status(404).json({ error: 'Conducteur introuvable' });
    return res.json({ id: String(user._id), kycStatus: user.kycStatus });
  } catch (err) {
    console.error('Approve KYC error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ADMIN: reject a driver KYC
router.post('/admin/:id/reject', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux admins' });
    const id = req.params.id;
    const user = await User.findOneAndUpdate({ _id: id, role: 'driver' }, { kycStatus: 'rejected' }, { new: true }).select('name phone plate kycStatus');
    if (!user) return res.status(404).json({ error: 'Conducteur introuvable' });
    return res.json({ id: String(user._id), kycStatus: user.kycStatus });
  } catch (err) {
    console.error('Reject KYC error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
