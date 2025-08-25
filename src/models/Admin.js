import mongoose from 'mongoose';
import BaseUser from './UserBase.js';

const AdminSchema = new mongoose.Schema(
  {
    // Admin-specific fields can go here (e.g., permissions)
  },
  { _id: false }
);

const Admin = mongoose.models.Admin || BaseUser.discriminator('admin', AdminSchema);

export default Admin;
