const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
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
    },
    rentRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RentRecord',
    },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ['cash', 'bank_transfer', 'upi', 'card', 'other'],
      required: true,
    },
    type: {
      type: String,
      enum: ['rent', 'deposit', 'deposit_refund', 'expense_reimbursement', 'other'],
      default: 'rent',
    },
    verificationStatus: {
      type: String,
      enum: ['manual_recorded', 'gateway_verified', 'pending_verification', 'failed'],
      default: 'manual_recorded',
    },
    /** Tenant marked this payment themselves (no admin approval) */
    reportedByTenant: { type: Boolean, default: false },
    /** Optional payment screenshot / PDF stored under uploads/private */
    proofFileKey: String,
    receiptNumber: { type: String, unique: true, sparse: true },
    referenceId: String,
    paidAt: { type: Date, default: Date.now },
    notes: String,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paymentSchema.index({ tenant: 1, paidAt: -1 });
paymentSchema.index({ property: 1, paidAt: -1 });
paymentSchema.index({ verificationStatus: 1, reportedByTenant: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
