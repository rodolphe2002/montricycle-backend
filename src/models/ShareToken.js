import mongoose from 'mongoose';

const ShareTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
  revoked: { type: Boolean, default: false },
}, { timestamps: false });

export default mongoose.models.ShareToken || mongoose.model('ShareToken', ShareTokenSchema);
