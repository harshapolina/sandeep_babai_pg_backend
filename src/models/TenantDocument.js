const mongoose = require('mongoose');

const tenantDocumentSchema = new mongoose.Schema(
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
      index: true,
    },
    label: { type: String, required: true },
    documentType: {
      type: String,
      enum: ['id_proof', 'address_proof', 'agreement', 'other'],
      default: 'other',
    },
    key: { type: String, required: true },
    originalName: String,
    mimeType: String,
    size: Number,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isPrivate: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TenantDocument', tenantDocumentSchema);
