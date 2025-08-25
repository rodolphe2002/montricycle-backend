import mongoose from 'mongoose';

const PricingSchema = new mongoose.Schema(
  {
    base: { type: Number, required: true, default: 300 },
    perKm: { type: Number, required: true, default: 150 },
    perMin: { type: Number, required: true, default: 40 },
    peakMultiplier: { type: Number, required: true, default: 1.5 },
    peakEnabled: { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Pricing || mongoose.model('Pricing', PricingSchema);
