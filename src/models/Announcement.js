const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        'maintenance',
        'water_supply',
        'electricity',
        'rent_deadline',
        'rules',
        'general',
      ],
      default: 'general',
    },
    scope: {
      type: String,
      enum: ['all', 'selected'],
      default: 'all',
    },
    properties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date, default: Date.now },
    expiresAt: Date,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

announcementSchema.index({ organization: 1, publishedAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
