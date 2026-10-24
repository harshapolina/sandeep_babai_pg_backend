const mongoose = require('mongoose');

const tenantAssignmentSchema = new mongoose.Schema(
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
    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Floor',
      required: true,
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    bed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bed',
      required: true,
      index: true,
    },
    moveInDate: { type: Date, required: true },
    moveOutDate: { type: Date, default: null },
    rentAmount: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Partial unique index: only one active assignment per bed
tenantAssignmentSchema.index(
  { bed: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
  }
);

tenantAssignmentSchema.index({ tenant: 1, isActive: 1 });
tenantAssignmentSchema.index({ property: 1, moveInDate: 1, moveOutDate: 1 });

module.exports = mongoose.model('TenantAssignment', tenantAssignmentSchema);
