const express = require('express');
const {
  Bed,
  Tenant,
  TenantAssignment,
  RentRecord,
  Payment,
  Expense,
  MaintenanceTicket,
  RegistrationSubmission,
  Property,
} = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  authenticate,
  requireStaff,
  getAccessiblePropertyIds,
} = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireStaff);

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  });
  return lines.join('\n');
}

router.get(
  '/occupancy',
  asyncHandler(async (req, res) => {
    const orgId = req.auth.organizationId;
    const allowed = getAccessiblePropertyIds(req);
    const propQuery = { organization: orgId, isActive: true };
    if (allowed) propQuery._id = { $in: allowed };
    if (req.query.propertyId) propQuery._id = req.query.propertyId;

    const properties = await Property.find(propQuery).lean();
    const rows = [];
    for (const p of properties) {
      const total = await Bed.countDocuments({ property: p._id, isActive: true });
      const occupied = await Bed.countDocuments({
        property: p._id,
        isActive: true,
        status: 'occupied',
      });
      const available = await Bed.countDocuments({
        property: p._id,
        isActive: true,
        status: 'available',
      });
      rows.push({
        property: p.name,
        totalBeds: total,
        occupied,
        available,
        occupancyPct: total ? Math.round((occupied / total) * 100) : 0,
      });
    }

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=occupancy.csv');
      return res.send(
        toCsv(rows, ['property', 'totalBeds', 'occupied', 'available', 'occupancyPct'])
      );
    }
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/outstanding-rent',
  asyncHandler(async (req, res) => {
    const query = {
      organization: req.auth.organizationId,
      status: { $in: ['pending', 'partial', 'overdue'] },
    };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) query.property = req.query.propertyId;

    const records = await RentRecord.find(query)
      .populate('tenant', 'fullName email phone')
      .populate('property', 'name')
      .lean();

    const rows = records.map((r) => ({
      tenant: r.tenant?.fullName,
      email: r.tenant?.email,
      property: r.property?.name,
      period: `${r.periodMonth}/${r.periodYear}`,
      amountDue: r.amountDue,
      amountPaid: r.amountPaid,
      outstanding: Math.max(0, r.amountDue - r.amountPaid),
      status: r.status,
      dueDate: r.dueDate,
    }));

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=outstanding-rent.csv');
      return res.send(
        toCsv(rows, [
          'tenant',
          'email',
          'property',
          'period',
          'amountDue',
          'amountPaid',
          'outstanding',
          'status',
          'dueDate',
        ])
      );
    }
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) query.property = req.query.propertyId;
    if (req.query.from || req.query.to) {
      query.createdAt = {};
      if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
    }

    const tickets = await MaintenanceTicket.find(query)
      .populate('tenant', 'fullName')
      .populate('property', 'name')
      .populate('assignedTo', 'fullName')
      .lean();

    const rows = tickets.map((t) => ({
      ticketNumber: t.ticketNumber,
      title: t.title,
      category: t.category,
      status: t.status,
      priority: t.priority,
      tenant: t.tenant?.fullName,
      property: t.property?.name,
      assignedTo: t.assignedTo?.fullName,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      responseHours:
        t.firstResponseAt && t.createdAt
          ? ((t.firstResponseAt - t.createdAt) / 3600000).toFixed(1)
          : '',
    }));

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=tickets.csv');
      return res.send(
        toCsv(rows, [
          'ticketNumber',
          'title',
          'category',
          'status',
          'priority',
          'tenant',
          'property',
          'assignedTo',
          'createdAt',
          'resolvedAt',
          'responseHours',
        ])
      );
    }
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/registrations',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };

    const items = await RegistrationSubmission.find(query)
      .populate('property', 'name')
      .lean();

    const rows = items.map((s) => ({
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      property: s.property?.name,
      status: s.status,
      createdAt: s.createdAt,
      reviewedAt: s.reviewedAt,
    }));

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=registrations.csv');
      return res.send(
        toCsv(rows, [
          'fullName',
          'email',
          'phone',
          'property',
          'status',
          'createdAt',
          'reviewedAt',
        ])
      );
    }
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/checkins',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };

    const items = await TenantAssignment.find(query)
      .populate('tenant', 'fullName')
      .populate('property', 'name')
      .populate('room', 'roomNumber')
      .populate('bed', 'bedNumber')
      .sort({ moveInDate: -1 })
      .lean();

    const rows = items.map((a) => ({
      tenant: a.tenant?.fullName,
      property: a.property?.name,
      room: a.room?.roomNumber,
      bed: a.bed?.bedNumber,
      moveInDate: a.moveInDate,
      moveOutDate: a.moveOutDate,
      isActive: a.isActive,
      rentAmount: a.rentAmount,
    }));

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=checkins.csv');
      return res.send(
        toCsv(rows, [
          'tenant',
          'property',
          'room',
          'bed',
          'moveInDate',
          'moveOutDate',
          'isActive',
          'rentAmount',
        ])
      );
    }
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/revenue',
  asyncHandler(async (req, res) => {
    const match = { organization: req.auth.organizationId, type: 'rent' };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) match.property = { $in: allowed };
    if (req.query.propertyId) match.property = req.query.propertyId;
    if (req.query.from || req.query.to) {
      match.paidAt = {};
      if (req.query.from) match.paidAt.$gte = new Date(req.query.from);
      if (req.query.to) match.paidAt.$lte = new Date(req.query.to);
    }

    const income = await Payment.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$property',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const properties = await Property.find({
      _id: { $in: income.map((i) => i._id) },
    }).lean();
    const map = Object.fromEntries(properties.map((p) => [p._id.toString(), p.name]));

    const rows = income.map((i) => ({
      property: map[i._id?.toString()] || 'Unknown',
      total: i.total,
      payments: i.count,
    }));

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=revenue.csv');
      return res.send(toCsv(rows, ['property', 'total', 'payments']));
    }
    res.json({ success: true, data: rows });
  })
);

module.exports = router;
