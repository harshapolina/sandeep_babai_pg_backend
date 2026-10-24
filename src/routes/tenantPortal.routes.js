const express = require('express');
const {
  TenantAssignment,
  RentRecord,
  Payment,
  SecurityDeposit,
  MaintenanceTicket,
  Announcement,
  Notification,
  Property,
  User,
} = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { authenticate, requireRoles } = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');
const { upload } = require('../middleware/upload');
const { generateReceiptNumber } = require('../utils/ticketNumber');

const router = express.Router();
router.use(authenticate, requireRoles('tenant'));

function requireTenantProfile(req) {
  if (!req.tenant) throw new AppError('Tenant profile not found', 404);
  return req.tenant;
}

router.get(
  '/home',
  asyncHandler(async (req, res) => {
    const tenant = requireTenantProfile(req);

    const [assignment, openTickets, notifications, announcements, nextRent] =
      await Promise.all([
        TenantAssignment.findOne({ tenant: tenant._id, isActive: true })
          .populate('property', 'name address contactPhone')
          .populate('floor', 'name level')
          .populate('room', 'roomNumber amenities')
          .populate('bed', 'bedNumber label'),
        MaintenanceTicket.countDocuments({
          tenant: tenant._id,
          status: {
            $in: ['open', 'assigned', 'in_progress', 'reopened', 'resolved_awaiting_confirmation'],
          },
        }),
        Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(8),
        Announcement.find({
          organization: req.auth.organizationId,
          isActive: true,
          $or: [{ scope: 'all' }, { properties: tenant.property }],
        })
          .sort({ publishedAt: -1 })
          .limit(5),
        RentRecord.findOne({
          tenant: tenant._id,
          status: { $in: ['pending', 'partial', 'overdue'] },
        }).sort({ dueDate: 1 }),
      ]);

    res.json({
      success: true,
      data: {
        welcomeName: tenant.fullName,
        tenant,
        assignment,
        openTickets,
        notifications,
        announcements,
        rentStatus: nextRent
          ? {
              status: nextRent.status,
              dueDate: nextRent.dueDate,
              outstanding: Math.max(0, nextRent.amountDue - nextRent.amountPaid),
              amountDue: nextRent.amountDue,
              amountPaid: nextRent.amountPaid,
            }
          : null,
      },
    });
  })
);

router.get(
  '/room',
  asyncHandler(async (req, res) => {
    const tenant = requireTenantProfile(req);
    const assignment = await TenantAssignment.findOne({
      tenant: tenant._id,
      isActive: true,
    })
      .populate('floor', 'name level')
      .populate('room', 'roomNumber amenities description roomType')
      .populate('bed', 'bedNumber label');

    if (!assignment) {
      return res.json({ success: true, data: { assignment: null, property: null } });
    }

    const property = await Property.findById(assignment.property).select(
      'name address contactPhone contactEmail facilities houseRules description city'
    );

    res.json({
      success: true,
      data: {
        assignment,
        property,
        // Intentionally omit other tenants
      },
    });
  })
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const tenant = requireTenantProfile(req);

    const [rents, payments, deposit, assignment] = await Promise.all([
      RentRecord.find({ tenant: tenant._id }).sort({ periodYear: -1, periodMonth: -1 }),
      Payment.find({ tenant: tenant._id }).sort({ paidAt: -1 }),
      SecurityDeposit.findOne({ tenant: tenant._id }),
      TenantAssignment.findOne({ tenant: tenant._id, isActive: true })
        .populate('room', 'roomNumber')
        .populate('bed', 'bedNumber label')
        .populate('property', 'name')
        .lean(),
    ]);

    res.json({
      success: true,
      data: {
        tenantName: tenant.fullName,
        roomLabel: assignment
          ? `Room ${assignment.room?.roomNumber || '—'} · Bed ${
              assignment.bed?.label || assignment.bed?.bedNumber || '—'
            }`
          : null,
        propertyName: assignment?.property?.name || null,
        rents: rents.map((r) => ({
          ...r.toObject(),
          outstanding: Math.max(0, r.amountDue - r.amountPaid),
        })),
        payments,
        deposit,
      },
    });
  })
);

/**
 * Tenant marks rent as paid immediately (no admin approval).
 * Optional screenshot via multipart field "proof".
 */
router.post(
  '/payments/mark-paid',
  upload.single('proof'),
  asyncHandler(async (req, res) => {
    const tenant = requireTenantProfile(req);
    const rentRecordId = req.body.rentRecordId;
    const amount = req.body.amount;
    const method = req.body.method || 'upi';
    const referenceId = req.body.referenceId;
    const notes = req.body.notes;
    const paidAt = req.body.paidAt;

    if (!rentRecordId || amount == null || amount === '') {
      throw new AppError('Select the rent month and enter amount', 400);
    }

    const rent = await RentRecord.findOne({
      _id: rentRecordId,
      tenant: tenant._id,
      organization: tenant.organization,
    });
    if (!rent) throw new AppError('Rent record not found', 404);
    if (rent.status === 'paid') {
      throw new AppError('This month is already marked paid', 400);
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      throw new AppError('Enter a valid amount', 400);
    }

    rent.amountPaid = Math.min(
      rent.amountDue,
      (rent.amountPaid || 0) + payAmount
    );
    if (rent.amountPaid >= rent.amountDue) {
      rent.status = 'paid';
    } else if (rent.amountPaid > 0) {
      rent.status = 'partial';
    } else {
      rent.status = rent.dueDate < new Date() ? 'overdue' : 'pending';
    }
    await rent.save();

    const payment = await Payment.create({
      organization: tenant.organization,
      tenant: tenant._id,
      property: rent.property || tenant.property,
      rentRecord: rent._id,
      amount: payAmount,
      method,
      type: 'rent',
      verificationStatus: 'manual_recorded',
      reportedByTenant: true,
      proofFileKey: req.file?.filename || undefined,
      referenceId: referenceId || undefined,
      notes: notes || undefined,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      recordedBy: req.user._id,
      receiptNumber: generateReceiptNumber(),
    });

    const admins = await User.find({
      organization: tenant.organization,
      role: 'org_admin',
      isActive: true,
    }).select('_id');

    for (const admin of admins) {
      await createNotification({
        organization: tenant.organization,
        user: admin._id,
        type: 'rent',
        title: 'Tenant marked rent paid',
        body: `${tenant.fullName} marked ₹${payAmount} paid (${method}).`,
        link: '/admin/payments',
        meta: { paymentId: payment._id, rentRecordId: rent._id },
      });
    }

    res.status(201).json({
      success: true,
      message: 'Marked as paid',
      data: { payment, rent },
    });
  })
);

module.exports = router;
