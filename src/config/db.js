const mongoose = require('mongoose');

let cached = global.__pgMongo;
if (!cached) {
  cached = global.__pgMongo = { conn: null, promise: null };
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(uri, {
        maxPoolSize: process.env.VERCEL ? 5 : 20,
        minPoolSize: process.env.VERCEL ? 0 : 2,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
        bufferCommands: false,
      })
      .then(async (m) => {
        console.log(`MongoDB connected: ${m.connection.name}`);
        try {
          const Bed = require('../models/Bed');
          await Bed.syncIndexes();
        } catch (err) {
          console.warn('Bed index sync skipped:', err.message);
        }
        return m;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDB };
