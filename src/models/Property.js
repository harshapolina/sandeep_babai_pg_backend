const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, default: 'Hyderabad' },
    state: { type: String, default: 'Telangana' },
    pincode: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    description: { type: String, trim: true },
    facilities: [{ type: String, trim: true }],
    images: [
      {
        url: String,
        key: String,
        caption: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    houseRules: { type: String, trim: true },
    defaultRentAmount: { type: Number, default: 0, min: 0 },
    defaultDepositAmount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

propertySchema.index({ organization: 1, name: 1 });

module.exports = mongoose.model('Property', propertySchema);
