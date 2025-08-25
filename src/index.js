import 'dotenv/config';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { connectDB } from './lib/db.js';
import authRoutes from './routes/auth.js';
import kycRoutes from './routes/kyc.js';
import ordersRoutes from './routes/orders.js';
import geocodeRoutes from './routes/geocode.js';
import shareRoutes from './routes/share.js';
import driversRoutes from './routes/drivers.js';
import clientsRoutes from './routes/clients.js';
import promosRoutes from './routes/promos.js';
import pricingRoutes from './routes/pricing.js';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
// Register discriminators
import './models/Client.js';
import './models/Driver.js';
import './models/Admin.js';

const app = express();

// Middlewares
// Configure Helmet to allow loading static images from another origin (frontend dev server)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: '*'}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/drivers', driversRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/api/promos', promosRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/share', shareRoutes);

// Static files for uploaded assets
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// Root endpoint to quickly verify deployment
app.get('/', (_req, res) => {
  res.type('text/plain').send('API accessible');
});

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();
  // Auto-bootstrap admin if none exists
  try {
    const count = await User.countDocuments({ role: 'admin' });
    if (count === 0) {
      const username = (process.env.ADMIN_USERNAME).toLowerCase();
      const password = process.env.ADMIN_PASSWORD;
      const name = process.env.ADMIN_NAME;
      if (!password || password.length < 6) {
        console.warn('[Bootstrap Admin] ADMIN_PASSWORD manquant ou trop court, utilisation de la valeur par défaut.');
      }
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(String(password), salt);
      await User.create({
        role: 'admin',
        name,
        phone: `admin-${Date.now()}`,
        username,
        passwordHash,
      });
      console.log(`[Bootstrap Admin] Administrateur créé avec succès. Utilisateur: ${username}`);
    }
  } catch (e) {
    console.error('[Bootstrap Admin] Erreur lors de la création de l’admin:', e);
  }
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log('API accessible');
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
