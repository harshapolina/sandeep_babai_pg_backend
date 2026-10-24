const mongoose = require('mongoose');

const securityDepositSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    amountHeld: { type: Number, required: true, min: 0 },
    amountRefunded: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['held', 'partially_refunded', 'refunded', 'forfeited'],
      default: 'held',
    },
    collectedAt: Date,
    refundedAt: Date,
    notes: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecurityDeposit', securityDepositSchema);
