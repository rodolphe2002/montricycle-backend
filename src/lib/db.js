import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 8000,
  });
  console.log('MongoDB connected');
}
