const express = require('express');
const mongoose = require('mongoose');
const { RentRecord, Payment, Expense, Tenant } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const {
  authenticate,
  requireStaff,
  requireAdmin,
  getAccessiblePropertyIds,
  assertPropertyAccess,
} = require('../middleware/auth');
const { generateReceiptNumber } = require('../utils/ticketNumber');
const { createNotification } = require('../services/notificationService');
const { writeAudit } = require('../services/auditService');

const router = express.Router();
router.use(authenticate);

function refreshRentStatus(record) {
  if (record.amountPaid <= 0) {
    record.status = record.dueDate < new Date() ? 'overdue' : 'pending';
  } else if (record.amountPaid < record.amountDue) {
    record.status = 'partial';
  } else {
    record.status = 'paid';
  }
}

// Staff: list rent records
router.get(
  '/rents',
  requireStaff,
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) {
      assertPropertyAccess(req, req.query.propertyId);
      query.property = req.query.propertyId;
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.tenantId) query.tenant = req.query.tenantId;
    if (req.query.month) query.periodMonth = Number(req.query.month);
    if (req.query.year) query.periodYear = Number(req.query.year);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    const [items, total] = await Promise.all([
      RentRecord.find(query)
        .populate('tenant', 'fullName email phone')
        .populate('property', 'name')
        .sort({ periodYear: -1, periodMonth: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      RentRecord.countDocuments(query),
    ]);

    const data = items.map((r) => ({
      ...r,
      outstanding: Math.max(0, (r.amountDue || 0) - (r.amountPaid || 0)),
    }));

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/rents',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { tenantId, periodMonth, periodYear, amountDue, dueDate } = req.body;
    if (!tenantId || !periodMonth || !periodYear || amountDue == null || !dueDate) {
      throw new AppError('Missing required rent fields', 400);
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      organization: req.auth.organizationId,
    });
    if (!tenant) throw new AppError('Tenant not found', 404);
    if (!tenant.property) throw new AppError('Tenant has no property', 400);

    const record = await RentRecord.create({
      organization: req.auth.organizationId,
      tenant: tenantId,
      property: tenant.property,
      periodMonth,
      periodYear,
      amountDue,
      dueDate: new Date(dueDate),
      status: new Date(dueDate) < new Date() ? 'overdue' : 'pending',
    });

    res.status(201).json({ success: true, data: record });
  })
);

router.post(
  '/rents/generate-month',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const month = Number(req.body.month) || new Date().getMonth() + 1;
    const year = Number(req.body.year) || new Date().getFullYear();
    const dueDay = Number(req.body.dueDay) || 5;

    const tenants = await Tenant.find({
      organization: req.auth.organizationId,
      status: 'active',
      agreedRent: { $gt: 0 },
    });

    let created = 0;
    for (const tenant of tenants) {
      try {
        await RentRecord.create({
          organization: req.auth.organizationId,
          tenant: tenant._id,
          property: tenant.property,
          periodMonth: month,
          periodYear: year,
          amountDue: tenant.agreedRent,
          dueDate: new Date(year, month - 1, dueDay),
          status: 'pending',
        });
        created += 1;
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }

    res.json({ success: true, created, month, year });
  })
);

router.post(
  '/record',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { tenantId, rentRecordId, amount, method, notes, paidAt, type } = req.body;
    if (!tenantId || !amount || !method) {
      throw new AppError('tenantId, amount, and method are required', 400);
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      organization: req.auth.organizationId,
    });
    if (!tenant) throw new AppError('Tenant not found', 404);

    let rentRecord = null;
    if (rentRecordId) {
      rentRecord = await RentRecord.findOne({
        _id: rentRecordId,
        tenant: tenantId,
        organization: req.auth.organizationId,
      });
      if (!rentRecord) throw new AppError('Rent record not found', 404);

      rentRecord.amountPaid += Number(amount);
      refreshRentStatus(rentRecord);
      await rentRecord.save();
    }

    const payment = await Payment.create({
      organization: req.auth.organizationId,
      tenant: tenantId,
      property: tenant.property,
      rentRecord: rentRecordId || undefined,
      amount: Number(amount),
      method,
      type: type || 'rent',
      verificationStatus: 'manual_recorded',
      receiptNumber: generateReceiptNumber(),
      notes,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      recordedBy: req.user._id,
    });

    if (tenant.user) {
      await createNotification({
        organization: req.auth.organizationId,
        user: tenant.user,
        type: 'rent',
        title: 'Payment recorded',
        body: `₹${amount} recorded (${method}). Receipt ${payment.receiptNumber}`,
        link: '/tenant/payments',
      });
    }

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'payment.manual_record',
      entityType: 'Payment',
      entityId: payment._id,
      after: payment.toObject(),
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        payment,
        rentRecord,
        note: 'Marked as manually recorded — not gateway-verified.',
      },
    });
  })
);

router.get(
  '/list',
  requireStaff,
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) query.property = req.query.propertyId;
    if (req.query.tenantId) query.tenant = req.query.tenantId;
    if (req.query.verificationStatus) {
      query.verificationStatus = req.query.verificationStatus;
    }
    if (req.query.pendingClaims === 'true') {
      query.reportedByTenant = true;
      query.verificationStatus = 'pending_verification';
    }

    const payments = await Payment.find(query)
      .populate('tenant', 'fullName email phone')
      .populate('property', 'name')
      .populate('rentRecord', 'periodMonth periodYear amountDue amountPaid status')
      .sort({ paidAt: -1 })
      .limit(100);
    res.json({ success: true, data: payments });
  })
);

/** Admin confirms a tenant-reported payment → rent marked paid/partial */
router.post(
  '/claims/:id/confirm',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const payment = await Payment.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
      reportedByTenant: true,
      verificationStatus: 'pending_verification',
    });
    if (!payment) throw new AppError('Pending claim not found', 404);

    let rentRecord = null;
    if (payment.rentRecord) {
      rentRecord = await RentRecord.findOne({
        _id: payment.rentRecord,
        organization: req.auth.organizationId,
      });
      if (rentRecord) {
        rentRecord.amountPaid += Number(payment.amount);
        refreshRentStatus(rentRecord);
        await rentRecord.save();
      }
    }

    payment.verificationStatus = 'manual_recorded';
    payment.verifiedBy = req.user._id;
    payment.verifiedAt = new Date();
    if (!payment.receiptNumber) payment.receiptNumber = generateReceiptNumber();
    await payment.save();

    const tenant = await Tenant.findById(payment.tenant);
    if (tenant?.user) {
      await createNotification({
        organization: req.auth.organizationId,
        user: tenant.user,
        type: 'rent',
        title: 'Payment confirmed',
        body: `Your payment of ₹${payment.amount} was verified by admin.`,
        link: '/tenant/payments',
      });
    }

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'payment.claim_confirm',
      entityType: 'Payment',
      entityId: payment._id,
      after: { amount: payment.amount, rentStatus: rentRecord?.status },
      req,
    });

    res.json({
      success: true,
      message: 'Payment confirmed',
      data: { payment, rentRecord },
    });
  })
);

/** Admin rejects a tenant-reported payment — rent stays unpaid */
router.post(
  '/claims/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const payment = await Payment.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
      reportedByTenant: true,
      verificationStatus: 'pending_verification',
    });
    if (!payment) throw new AppError('Pending claim not found', 404);

    payment.verificationStatus = 'failed';
    payment.rejectionReason = req.body.reason || 'Could not verify payment';
    payment.verifiedBy = req.user._id;
    payment.verifiedAt = new Date();
    await payment.save();

    const tenant = await Tenant.findById(payment.tenant);
    if (tenant?.user) {
      await createNotification({
        organization: req.auth.organizationId,
        user: tenant.user,
        type: 'rent',
        title: 'Payment not verified',
        body: `Your reported payment could not be verified. ${payment.rejectionReason}`,
        link: '/tenant/payments',
      });
    }

    res.json({ success: true, message: 'Claim rejected', data: payment });
  })
);

router.post(
  '/expenses',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { propertyId, category, title, description, amount, expenseDate, paymentMethod } =
      req.body;
    if (!title || amount == null || !expenseDate) {
      throw new AppError('title, amount, and expenseDate required', 400);
    }
    if (propertyId) assertPropertyAccess(req, propertyId);

    const expense = await Expense.create({
      organization: req.auth.organizationId,
      property: propertyId || undefined,
      category: category || 'other',
      title,
      description,
      amount,
      expenseDate: new Date(expenseDate),
      paymentMethod: paymentMethod || 'cash',
      recordedBy: req.user._id,
    });

    res.status(201).json({ success: true, data: expense });
  })
);

router.get(
  '/expenses',
  requireStaff,
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) query.property = req.query.propertyId;

    const expenses = await Expense.find(query)
      .populate('property', 'name')
      .sort({ expenseDate: -1 })
      .limit(100);
    res.json({ success: true, data: expenses });
  })
);

router.get(
  '/summary',
  requireStaff,
  asyncHandler(async (req, res) => {
    const orgId = req.auth.organizationId;
    const allowed = getAccessiblePropertyIds(req);
    const match = { organization: orgId };
    if (allowed) match.property = { $in: allowed };
    if (req.query.propertyId) match.property = new mongoose.Types.ObjectId(req.query.propertyId);

    const [income, pending, expenses] = await Promise.all([
      Payment.aggregate([
        { $match: { ...match, type: 'rent' } },
        { $group: { _id: '$property', total: { $sum: '$amount' } } },
      ]),
      RentRecord.aggregate([
        {
          $match: {
            ...match,
            status: { $in: ['pending', 'partial', 'overdue'] },
          },
        },
        {
          $group: {
            _id: '$property',
            total: { $sum: { $subtract: ['$amountDue', '$amountPaid'] } },
          },
        },
      ]),
      Expense.aggregate([
        { $match: match },
        { $group: { _id: '$property', total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({ success: true, data: { income, pending, expenses } });
  })
);

module.exports = router;
