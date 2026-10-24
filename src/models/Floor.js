const mongoose = require('mongoose');

const floorSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true },
    level: { type: Number, required: true },
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

floorSchema.index({ property: 1, level: 1 }, { unique: true });

module.exports = mongoose.model('Floor', floorSchema);
