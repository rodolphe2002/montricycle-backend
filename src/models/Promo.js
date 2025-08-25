import mongoose from 'mongoose';

const PromoSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, required: true, trim: true }, // ex: TRI2025
    type: { type: String, enum: ['percent', 'amount'], default: 'percent' },
    value: { type: Number, required: true, min: 0 }, // percent: 0-100, amount: CFA
    active: { type: Boolean, default: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.Promo || mongoose.model('Promo', PromoSchema);
