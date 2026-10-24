const mongoose = require('mongoose');

const rentRecordSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
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
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TenantAssignment',
    },
    periodMonth: { type: Number, required: true, min: 1, max: 12 },
    periodYear: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    amountDue: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue', 'waived'],
      default: 'pending',
      index: true,
    },
    notes: String,
  },
  { timestamps: true }
);

rentRecordSchema.index(
  { tenant: 1, periodMonth: 1, periodYear: 1 },
  { unique: true }
);

rentRecordSchema.virtual('outstanding').get(function outstanding() {
  return Math.max(0, this.amountDue - this.amountPaid);
});

rentRecordSchema.set('toJSON', { virtuals: true });
rentRecordSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('RentRecord', rentRecordSchema);
