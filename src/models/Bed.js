const mongoose = require('mongoose');

const BED_STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];

const bedSchema = new mongoose.Schema(
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
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    bedNumber: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    status: {
      type: String,
      enum: BED_STATUSES,
      default: 'available',
      index: true,
    },
    rentAmount: { type: Number, min: 0 },
    notes: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Soft-deleted beds must not block re-using a bed number in the same room.
bedSchema.index(
  { room: 1, bedNumber: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
bedSchema.index({ property: 1, status: 1 });

module.exports = mongoose.model('Bed', bedSchema);
module.exports.BED_STATUSES = BED_STATUSES;
