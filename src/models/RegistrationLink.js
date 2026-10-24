const mongoose = require('mongoose');
const crypto = require('crypto');

const DEFAULT_FORM_CONFIG = {
  brandName: 'Has Tracker',
  title: 'Apply for a bed',
  subtitle: 'One application for all our homes. Pick a property and tell us about you.',
  welcomeMessage: '',
  ctaLabel: 'Submit application',
  successTitle: 'You’re in',
  successMessage:
    'Your account is ready. Admin will assign your room and bed next. You can sign in anytime.',
  showEmergencyContact: true,
  requireEmergencyContact: false,
  showMoveInDate: true,
  showRoomPreference: true,
  showOccupation: true,
  showGender: true,
  showNotes: true,
  includedPropertyIds: [], // empty = all active properties
};

const registrationLinkSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // Optional when isMaster — applicants pick property on the form
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: false,
      index: true,
    },
    isMaster: { type: Boolean, default: false, index: true },
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(24).toString('hex'),
    },
    label: { type: String, trim: true },
    formConfig: {
      brandName: { type: String, default: DEFAULT_FORM_CONFIG.brandName },
      title: { type: String, default: DEFAULT_FORM_CONFIG.title },
      subtitle: { type: String, default: DEFAULT_FORM_CONFIG.subtitle },
      welcomeMessage: { type: String, default: '' },
      ctaLabel: { type: String, default: DEFAULT_FORM_CONFIG.ctaLabel },
      successTitle: { type: String, default: DEFAULT_FORM_CONFIG.successTitle },
      successMessage: { type: String, default: DEFAULT_FORM_CONFIG.successMessage },
      showEmergencyContact: { type: Boolean, default: true },
      requireEmergencyContact: { type: Boolean, default: false },
      showMoveInDate: { type: Boolean, default: true },
      showRoomPreference: { type: Boolean, default: true },
      showOccupation: { type: Boolean, default: true },
      showGender: { type: Boolean, default: true },
      showNotes: { type: Boolean, default: true },
      includedPropertyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],
    },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    bed: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed' },
    maxRent: { type: Number, min: 0 },
    minRent: { type: Number, min: 0 },
    expiresAt: Date,
    maxUses: { type: Number, default: null },
    useCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

registrationLinkSchema.methods.isValidForUse = function isValidForUse() {
  if (!this.isActive) return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  if (this.maxUses != null && this.useCount >= this.maxUses) return false;
  return true;
};

module.exports = mongoose.model('RegistrationLink', registrationLinkSchema);
module.exports.DEFAULT_FORM_CONFIG = DEFAULT_FORM_CONFIG;
