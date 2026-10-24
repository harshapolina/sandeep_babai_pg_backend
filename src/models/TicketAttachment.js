const mongoose = require('mongoose');

const ticketAttachmentSchema = new mongoose.Schema(
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
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    key: { type: String, required: true },
    originalName: String,
    mimeType: String,
    size: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model('TicketAttachment', ticketAttachmentSchema);
