const mongoose = require('mongoose');

const TENANT_STATUSES = ['pending', 'active', 'checked_out', 'inactive'];

const tenantSchema = new mongoose.Schema(
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
      unique: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      index: true,
    },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    emergencyContact: {
      name: String,
      phone: String,
      relation: String,
    },
    idType: {
      type: String,
      enum: ['aadhaar', 'pan', 'passport', 'driving_license', 'other', ''],
      default: '',
    },
    idNumberMasked: String,
    status: {
      type: String,
      enum: TENANT_STATUSES,
      default: 'pending',
      index: true,
    },
    registrationStatus: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected'],
      default: 'submitted',
    },
    agreedRent: { type: Number, min: 0, default: 0 },
    securityDeposit: { type: Number, min: 0, default: 0 },
    moveInDate: Date,
    moveOutDate: Date,
    notes: String,
    preferredRoomType: String,
    preferredBed: String,
  },
  { timestamps: true }
);

tenantSchema.index({ organization: 1, property: 1, status: 1 });
tenantSchema.index({ email: 1, organization: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
module.exports.TENANT_STATUSES = TENANT_STATUSES;
