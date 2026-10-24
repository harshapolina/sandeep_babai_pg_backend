const mongoose = require('mongoose');

const TICKET_CATEGORIES = [
  'plumbing',
  'electrical',
  'cleaning',
  'furniture',
  'internet',
  'water_supply',
  'other',
];

const TICKET_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'resolved_awaiting_confirmation',
  'closed',
  'reopened',
];

const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const maintenanceTicketSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    ticketNumber: { type: String, unique: true, required: true },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    bed: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed' },
    category: {
      type: String,
      enum: TICKET_CATEGORIES,
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    priority: {
      type: String,
      enum: TICKET_PRIORITIES,
      default: 'medium',
    },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: 'open',
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    assignedAt: Date,
    resolutionNotes: String,
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tenantConfirmedAt: Date,
    closedAt: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    adminOverrideClose: { type: Boolean, default: false },
    overrideReason: String,
    reopenReason: String,
    firstResponseAt: Date,
  },
  { timestamps: true }
);

maintenanceTicketSchema.index({ property: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('MaintenanceTicket', maintenanceTicketSchema);
module.exports.TICKET_CATEGORIES = TICKET_CATEGORIES;
module.exports.TICKET_STATUSES = TICKET_STATUSES;
module.exports.TICKET_PRIORITIES = TICKET_PRIORITIES;
