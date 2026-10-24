const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Floor',
      required: true,
      index: true,
    },
    roomNumber: { type: String, required: true, trim: true },
    roomType: {
      type: String,
      enum: ['single', 'double', 'triple', 'quad', 'dorm', 'other'],
      default: 'double',
    },
    capacity: { type: Number, required: true, min: 1 },
    rentType: {
      type: String,
      enum: ['per_bed', 'per_room'],
      default: 'per_bed',
    },
    rentAmount: { type: Number, required: true, min: 0 },
    description: String,
    amenities: [{ type: String, trim: true }],
    images: [
      {
        url: String,
        key: String,
        caption: String,
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

roomSchema.index({ property: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model('Room', roomSchema);
