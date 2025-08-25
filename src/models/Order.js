import mongoose from 'mongoose';

const PointSchema = new mongoose.Schema(
  {
    name: { type: String },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    start: { type: PointSchema, required: true },
    destination: { type: PointSchema, required: true },
    passengers: { type: Number, default: 1, min: 1, max: 3 },
    bags: { type: Number, default: 0, min: 0, max: 3 },
    // Baggage offer: client's proposed price and description
    bagOffer: { type: Number, default: 0, min: 0 },
    bagDescription: { type: String, trim: true },
    accessible: { type: Boolean, default: false },
    promoCode: { type: String },
    priceEstimate: { type: Number },
    status: { type: String, enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    // Payment & receipts
    tip: { type: Number, default: 0 },
    paymentMethod: { type: String, trim: true },
    finalizedAt: { type: Date },
    receiptRequested: { type: String, enum: ['email', 'pdf', null], default: null },
    receiptEmail: { type: String, trim: true },
    receiptSentAt: { type: Date },
    // Client feedback
    rating: { type: Number, min: 1, max: 5 },
    review: { type: String, trim: true },
    // Cancellation / dispute (optional)
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true },
    cancellation: {
      reason: { type: String, trim: true },
      feesApplied: { type: Boolean, default: false },
      disputeStatus: { type: String, enum: ['open', 'closed', 'none'], default: 'open' },
      action: { type: String, trim: true }, // e.g., "Frais appliqués"
    },
  },
  { timestamps: true }
);

export default mongoose.models.Order || mongoose.model('Order', OrderSchema);

