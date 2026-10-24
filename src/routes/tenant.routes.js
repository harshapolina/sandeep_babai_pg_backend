const express = require('express');
const {
  Tenant,
  TenantAssignment,
  RentRecord,
  Payment,
  SecurityDeposit,
  Bed,
} = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const {
  authenticate,
  requireStaff,
  requireAdmin,
  getAccessiblePropertyIds,
  assertPropertyAccess,
} = require('../middleware/auth');
const { assignTenantToBed, checkoutTenant } = require('../services/assignmentService');

const router = express.Router();
router.use(authenticate, requireStaff);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) {
      assertPropertyAccess(req, req.query.propertyId);
      query.property = req.query.propertyId;
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.q) {
      query.$or = [
        { fullName: new RegExp(req.query.q, 'i') },
        { email: new RegExp(req.query.q, 'i') },
        { phone: new RegExp(req.query.q, 'i') },
      ];
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Tenant.find(query)
        .populate('property', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Tenant.countDocuments(query),
    ]);

    const tenantIds = items.map((t) => t._id);
    const [assignments, overdueRents] = await Promise.all([
      TenantAssignment.find({ tenant: { $in: tenantIds }, isActive: true })
        .populate('floor', 'name level')
        .populate('room', 'roomNumber')
        .populate('bed', 'bedNumber label status')
        .lean(),
      RentRecord.find({
        tenant: { $in: tenantIds },
        status: { $in: ['pending', 'partial', 'overdue'] },
      })
        .sort({ dueDate: 1 })
        .lean(),
    ]);

    const assignmentMap = Object.fromEntries(
      assignments.map((a) => [a.tenant.toString(), a])
    );
    const overdueMap = {};
    for (const r of overdueRents) {
      const key = r.tenant.toString();
      if (!overdueMap[key]) overdueMap[key] = r;
    }

    const data = items.map((t) => {
      const overdue = overdueMap[t._id.toString()];
      return {
        ...t,
        assignment: assignmentMap[t._id.toString()] || null,
        paymentStatus: overdue
          ? overdue.status
          : t.status === 'active'
            ? 'paid'
            : 'n/a',
      };
    });

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    }).populate('property', 'name address');
    if (!tenant) throw new AppError('Tenant not found', 404);
    if (tenant.property) assertPropertyAccess(req, tenant.property._id || tenant.property);

    const [assignment, history, rents, payments, deposit] = await Promise.all([
      TenantAssignment.findOne({ tenant: tenant._id, isActive: true })
        .populate('floor', 'name level')
        .populate('room', 'roomNumber amenities')
        .populate('bed', 'bedNumber label'),
      TenantAssignment.find({ tenant: tenant._id })
        .sort({ moveInDate: -1 })
        .populate('room', 'roomNumber')
        .populate('bed', 'bedNumber label'),
      RentRecord.find({ tenant: tenant._id }).sort({ periodYear: -1, periodMonth: -1 }),
      Payment.find({ tenant: tenant._id }).sort({ paidAt: -1 }).limit(50),
      SecurityDeposit.findOne({ tenant: tenant._id }),
    ]);

    res.json({
      success: true,
      data: {
        tenant,
        assignment,
        history,
        rents,
        payments,
        deposit,
      },
    });
  })
);

router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!tenant) throw new AppError('Tenant not found', 404);

    [
      'fullName',
      'phone',
      'emergencyContact',
      'agreedRent',
      'securityDeposit',
      'notes',
      'status',
    ].forEach((f) => {
      if (req.body[f] !== undefined) tenant[f] = req.body[f];
    });
    await tenant.save();
    res.json({ success: true, data: tenant });
  })
);

router.post(
  '/:id/assign',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { bedId, moveInDate, rentAmount, securityDepositAmount } = req.body;
    if (!bedId) throw new AppError('bedId is required', 400);

    const bed = await Bed.findOne({
      _id: bedId,
      organization: req.auth.organizationId,
    });
    if (!bed) throw new AppError('Bed not found', 404);
    assertPropertyAccess(req, bed.property);

    const assignment = await assignTenantToBed({
      organizationId: req.auth.organizationId,
      tenantId: req.params.id,
      bedId,
      moveInDate: moveInDate ? new Date(moveInDate) : new Date(),
      rentAmount,
      securityDepositAmount,
      createdBy: req.user._id,
      req,
    });

    const populated = await TenantAssignment.findById(assignment._id)
      .populate('room', 'roomNumber')
      .populate('bed', 'bedNumber label')
      .populate('floor', 'name level')
      .populate('property', 'name');

    res.json({ success: true, data: populated });
  })
);

router.post(
  '/:id/transfer',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { bedId, moveInDate, rentAmount } = req.body;
    if (!bedId) throw new AppError('bedId is required', 400);

    const bed = await Bed.findOne({
      _id: bedId,
      organization: req.auth.organizationId,
    });
    if (!bed) throw new AppError('Bed not found', 404);
    assertPropertyAccess(req, bed.property);

    const assignment = await assignTenantToBed({
      organizationId: req.auth.organizationId,
      tenantId: req.params.id,
      bedId,
      moveInDate: moveInDate ? new Date(moveInDate) : new Date(),
      rentAmount,
      createdBy: req.user._id,
      req,
    });

    res.json({ success: true, data: assignment });
  })
);

router.post(
  '/:id/checkout',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenant = await checkoutTenant({
      organizationId: req.auth.organizationId,
      tenantId: req.params.id,
      moveOutDate: req.body.moveOutDate ? new Date(req.body.moveOutDate) : new Date(),
      actorId: req.user._id,
      req,
    });
    res.json({ success: true, data: tenant });
  })
);

module.exports = router;
