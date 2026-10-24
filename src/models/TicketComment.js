const mongoose = require('mongoose');

const ticketCommentSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceTicket',
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    body: { type: String, required: true, trim: true },
    isInternal: { type: Boolean, default: false },
    attachments: [
      {
        url: String,
        key: String,
        originalName: String,
        mimeType: String,
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('TicketComment', ticketCommentSchema);
