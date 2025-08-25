import mongoose from 'mongoose';
import BaseUser from './UserBase.js';

const ClientSchema = new mongoose.Schema(
  {
    // Admin status
    clientStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    district: { type: String },
  },
  { _id: false }
);

const Client = mongoose.models.Client || BaseUser.discriminator('client', ClientSchema);

export default Client;
