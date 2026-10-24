const mongoose = require('mongoose');

const staffAssignmentSchema = new mongoose.Schema(
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
    properties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
      },
    ],
    role: {
      type: String,
      enum: [
        'property_manager',
        'maintenance_staff',
        'cleaning_staff',
        'accountant',
        'readonly_staff',
      ],
      required: true,
    },
    permissions: {
      manageProperties: { type: Boolean, default: false },
      manageTenants: { type: Boolean, default: false },
      manageRent: { type: Boolean, default: false },
      manageTickets: { type: Boolean, default: true },
      manageStaff: { type: Boolean, default: false },
      viewReports: { type: Boolean, default: false },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

staffAssignmentSchema.index({ user: 1, organization: 1 }, { unique: true });

module.exports = mongoose.model('StaffAssignment', staffAssignmentSchema);
