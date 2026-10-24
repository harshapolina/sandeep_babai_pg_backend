const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User, Tenant } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      org: user.organization.toString(),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400, errors.array());
    }

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Invalid email or password', 401);
    }
    if (!user.isActive) throw new AppError('Account is inactive', 403);

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    let tenantProfile = null;
    if (user.role === 'tenant') {
      tenantProfile = await Tenant.findOne({ user: user._id })
        .populate('property', 'name address')
        .lean();
    }

    res.json({
      success: true,
      token,
      user: user.toSafeJSON(),
      tenant: tenantProfile,
    });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    let tenantProfile = null;
    if (req.user.role === 'tenant') {
      tenantProfile = await Tenant.findOne({ user: req.user._id })
        .populate('property', 'name address contactPhone')
        .lean();
    }

    res.json({
      success: true,
      user: req.user.toSafeJSON(),
      tenant: tenantProfile,
      staffAssignment: req.staffAssignment || null,
    });
  })
);

router.patch(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { fullName, phone, notificationPreferences } = req.body;
    if (fullName) req.user.fullName = fullName;
    if (phone) req.user.phone = phone;
    if (notificationPreferences) {
      req.user.notificationPreferences = {
        ...req.user.notificationPreferences.toObject?.() ||
          req.user.notificationPreferences,
        ...notificationPreferences,
      };
    }
    await req.user.save();

    if (req.user.role === 'tenant' && req.tenant) {
      if (fullName) req.tenant.fullName = fullName;
      if (phone) req.tenant.phone = phone;
      if (req.body.emergencyContact) {
        req.tenant.emergencyContact = {
          ...req.tenant.emergencyContact?.toObject?.() ||
            req.tenant.emergencyContact ||
            {},
          ...req.body.emergencyContact,
        };
      }
      await req.tenant.save();
    }

    res.json({ success: true, user: req.user.toSafeJSON() });
  })
);

router.post(
  '/change-password',
  authenticate,
  body('currentPassword').isLength({ min: 6 }),
  body('newPassword').isLength({ min: 8 }),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400, errors.array());
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await user.comparePassword(req.body.currentPassword))) {
      throw new AppError('Current password is incorrect', 400);
    }

    user.passwordHash = await User.hashPassword(req.body.newPassword);
    await user.save();
    res.json({ success: true, message: 'Password updated' });
  })
);

module.exports = router;
