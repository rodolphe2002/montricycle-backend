import mongoose from 'mongoose';

// Base User schema with discriminatorKey 'role'
const BaseUserSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['client', 'driver', 'admin'], required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, index: true },
    username: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    email: { type: String, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    createdAtMs: { type: Number, default: () => Date.now() },
  },
  { timestamps: true, discriminatorKey: 'role', collection: 'users' }
);

BaseUserSchema.index({ name: 'text', phone: 'text', email: 'text' });

const BaseUser = mongoose.models.User || mongoose.model('User', BaseUserSchema);

export default BaseUser;
