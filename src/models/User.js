const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = [
  'org_admin',
  'property_manager',
  'maintenance_staff',
  'cleaning_staff',
  'accountant',
  'readonly_staff',
  'tenant',
];

const userSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    role: {
      type: String,
      enum: ROLES,
      required: true,
      index: true,
    },
    avatarUrl: String,
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      rentReminders: { type: Boolean, default: true },
      ticketUpdates: { type: Boolean, default: true },
      announcements: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.statics.hashPassword = async function hashPassword(password) {
  return bcrypt.hash(password, 12);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    organization: this.organization,
    email: this.email,
    fullName: this.fullName,
    phone: this.phone,
    role: this.role,
    avatarUrl: this.avatarUrl,
    isActive: this.isActive,
    notificationPreferences: this.notificationPreferences,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
