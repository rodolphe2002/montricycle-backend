import mongoose from 'mongoose';
import BaseUser from './UserBase.js';

const DriverSchema = new mongoose.Schema(
  {
    // KYC & profile
    plate: { type: String },
    kycStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    vehiclePhotoUrl: { type: String },
    idPhotoUrl: { type: String },
    selfieUrl: { type: String },

    // Admin status & metrics
    driverStatus: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active', index: true },
    rating: { type: Number, default: 4.8, min: 0, max: 5 },

    // Presence
    online: { type: Boolean, default: false, index: true },
    lastSeenAt: { type: Date },

    // Live location
    currentLat: { type: Number },
    currentLon: { type: Number },
    currentAcc: { type: Number },
  },
  { _id: false }
);

const Driver = mongoose.models.Driver || BaseUser.discriminator('driver', DriverSchema);

export default Driver;
