const express = require('express');
const { User, StaffAssignment } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { writeAudit } = require('../services/auditService');

const router = express.Router();
router.use(authenticate, requireAdmin);

const STAFF_ROLES = [
  'property_manager',
  'maintenance_staff',
  'cleaning_staff',
  'accountant',
  'readonly_staff',
];

function defaultPermissions(role) {
  switch (role) {
    case 'property_manager':
      return {
        manageProperties: true,
        manageTenants: true,
        manageRent: true,
        manageTickets: true,
        manageStaff: false,
        viewReports: true,
      };
    case 'accountant':
      return {
        manageProperties: false,
        manageTenants: false,
        manageRent: true,
        manageTickets: false,
        manageStaff: false,
        viewReports: true,
      };
    case 'readonly_staff':
      return {
        manageProperties: false,
        manageTenants: false,
        manageRent: false,
        manageTickets: false,
        manageStaff: false,
        viewReports: true,
      };
    default:
      return {
        manageProperties: false,
        manageTenants: false,
        manageRent: false,
        manageTickets: true,
        manageStaff: false,
        viewReports: false,
      };
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const staff = await User.find({
      organization: req.auth.organizationId,
      role: { $in: STAFF_ROLES },
    }).sort({ fullName: 1 });

    const assignments = await StaffAssignment.find({
      organization: req.auth.organizationId,
    }).populate('properties', 'name');

    const data = staff.map((u) => ({
      ...u.toSafeJSON(),
      assignment: assignments.find((a) => a.user.toString() === u._id.toString()) || null,
    }));

    res.json({ success: true, data });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { email, password, fullName, phone, role, propertyIds, permissions } = req.body;
    if (!email || !password || !fullName || !role) {
      throw new AppError('email, password, fullName, and role are required', 400);
    }
    if (!STAFF_ROLES.includes(role)) throw new AppError('Invalid staff role', 400);

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) throw new AppError('Email already in use', 409);

    const user = await User.create({
      organization: req.auth.organizationId,
      email: email.toLowerCase(),
      passwordHash: await User.hashPassword(password),
      fullName,
      phone,
      role,
    });

    const assignment = await StaffAssignment.create({
      organization: req.auth.organizationId,
      user: user._id,
      properties: propertyIds || [],
      role,
      permissions: permissions || defaultPermissions(role),
    });

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'staff.create',
      entityType: 'User',
      entityId: user._id,
      after: { role, propertyIds },
      req,
    });

    res.status(201).json({
      success: true,
      data: { user: user.toSafeJSON(), assignment },
    });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
      role: { $in: STAFF_ROLES },
    });
    if (!user) throw new AppError('Staff not found', 404);

    if (req.body.fullName) user.fullName = req.body.fullName;
    if (req.body.phone) user.phone = req.body.phone;
    if (req.body.role && STAFF_ROLES.includes(req.body.role)) user.role = req.body.role;
    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    await user.save();

    let assignment = await StaffAssignment.findOne({ user: user._id });
    if (assignment) {
      if (req.body.propertyIds) assignment.properties = req.body.propertyIds;
      if (req.body.role) assignment.role = req.body.role;
      if (req.body.permissions) {
        assignment.permissions = { ...assignment.permissions.toObject(), ...req.body.permissions };
      }
      if (req.body.isActive !== undefined) assignment.isActive = req.body.isActive;
      await assignment.save();
    }

    res.json({ success: true, data: { user: user.toSafeJSON(), assignment } });
  })
);

module.exports = router;
