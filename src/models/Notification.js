const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'registration',
        'ticket',
        'rent',
        'announcement',
        'assignment',
        'system',
      ],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: String,
    meta: mongoose.Schema.Types.Mixed,
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    emailAttempted: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
    emailSkippedReason: String,
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
