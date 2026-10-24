const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
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
      index: true,
    },
    category: {
      type: String,
      enum: [
        'maintenance',
        'utilities',
        'staff',
        'supplies',
        'rent',
        'internet',
        'cleaning',
        'other',
      ],
      default: 'other',
    },
    title: { type: String, required: true, trim: true },
    description: String,
    amount: { type: Number, required: true, min: 0 },
    expenseDate: { type: Date, required: true },
    paymentMethod: {
      type: String,
      enum: ['cash', 'bank_transfer', 'upi', 'card', 'other'],
      default: 'cash',
    },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

expenseSchema.index({ organization: 1, expenseDate: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
