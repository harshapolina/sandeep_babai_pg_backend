const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);

  // Drop legacy full unique indexes and apply soft-delete-safe bed indexes.
  try {
    const Bed = require('../models/Bed');
    await Bed.syncIndexes();
  } catch (err) {
    console.warn('Bed index sync skipped:', err.message);
  }
}

module.exports = { connectDB };
