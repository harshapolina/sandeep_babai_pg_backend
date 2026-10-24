const express = require('express');
const mongoose = require('mongoose');
const {
  Property,
  Floor,
  Room,
  Bed,
  Tenant,
  RegistrationSubmission,
  RentRecord,
  Payment,
  Expense,
  MaintenanceTicket,
} = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { authenticate, requireStaff, getAccessiblePropertyIds } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireStaff);

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const orgId = req.auth.organizationId;
    const propertyFilter = getAccessiblePropertyIds(req);
    const propertyQuery = { organization: orgId, isActive: true };
    if (propertyFilter) propertyQuery._id = { $in: propertyFilter };

    const { propertyId } = req.query;
    if (propertyId) {
      if (propertyFilter && !propertyFilter.includes(propertyId)) {
        return res.status(403).json({ success: false, message: 'No access' });
      }
      propertyQuery._id = new mongoose.Types.ObjectId(propertyId);
    }

    const properties = await Property.find(propertyQuery).select('_id name').lean();
    const propertyIds = properties.map((p) => p._id);
    const empty = {
      totals: {
        properties: 0,
        floors: 0,
        rooms: 0,
        beds: 0,
        occupiedBeds: 0,
        availableBeds: 0,
        reservedBeds: 0,
        maintenanceBeds: 0,
        activeTenants: 0,
        pendingRegistrations: 0,
        monthlyRentCollected: 0,
        pendingRent: 0,
        openTickets: 0,
        ticketsAwaitingConfirmation: 0,
        monthlyExpenses: 0,
      },
      occupancyByProperty: [],
      monthlyChart: [],
      recentTenants: [],
      recentTickets: [],
      upcomingRent: [],
    };

    if (!propertyIds.length) {
      return res.json({ success: true, data: empty });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const chartStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const upcomingEnd = new Date(now.getTime() + 14 * 86400000);
    const scope = { organization: orgId, property: { $in: propertyIds } };

    const [
      floors,
      rooms,
      bedAgg,
      activeTenants,
      pendingRegs,
      monthlyPayments,
      pendingRent,
      ticketStatusAgg,
      expensesMonth,
      occupancyAgg,
      revenueByMonth,
      expenseByMonth,
      recentTenants,
      recentTickets,
      upcomingRent,
    ] = await Promise.all([
      Floor.countDocuments({ ...scope, isActive: true }),
      Room.countDocuments({ ...scope, isActive: true }),
      Bed.aggregate([
        { $match: { ...scope, isActive: true } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Tenant.countDocuments({
        organization: orgId,
        property: { $in: propertyIds },
        status: 'active',
      }),
      RegistrationSubmission.countDocuments({
        organization: orgId,
        property: { $in: propertyIds },
        status: 'pending',
      }),
      Payment.aggregate([
        {
          $match: {
            organization: orgId,
            property: { $in: propertyIds },
            type: 'rent',
            paidAt: { $gte: monthStart, $lte: monthEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      RentRecord.aggregate([
        {
          $match: {
            organization: orgId,
            property: { $in: propertyIds },
            status: { $in: ['pending', 'partial', 'overdue'] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $subtract: ['$amountDue', '$amountPaid'] } },
          },
        },
      ]),
      MaintenanceTicket.aggregate([
        { $match: { ...scope } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            organization: orgId,
            property: { $in: propertyIds },
            expenseDate: { $gte: monthStart, $lte: monthEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Bed.aggregate([
        { $match: { ...scope, isActive: true } },
        {
          $group: {
            _id: '$property',
            totalBeds: { $sum: 1 },
            occupiedBeds: {
              $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] },
            },
          },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            organization: orgId,
            property: { $in: propertyIds },
            type: 'rent',
            paidAt: { $gte: chartStart, $lte: monthEnd },
          },
        },
        {
          $group: {
            _id: {
              y: { $year: '$paidAt' },
              m: { $month: '$paidAt' },
            },
            total: { $sum: '$amount' },
          },
        },
      ]),
      Expense.aggregate([
        {
          $match: {
            organization: orgId,
            property: { $in: propertyIds },
            expenseDate: { $gte: chartStart, $lte: monthEnd },
          },
        },
        {
          $group: {
            _id: {
              y: { $year: '$expenseDate' },
              m: { $month: '$expenseDate' },
            },
            total: { $sum: '$amount' },
          },
        },
      ]),
      Tenant.find({ organization: orgId, property: { $in: propertyIds } })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('fullName email status property createdAt registrationStatus')
        .populate('property', 'name')
        .lean(),
      MaintenanceTicket.find({ ...scope })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('tenant', 'fullName')
        .populate('property', 'name')
        .lean(),
      RentRecord.find({
        organization: orgId,
        property: { $in: propertyIds },
        status: { $in: ['pending', 'partial', 'overdue'] },
        dueDate: { $gte: now, $lte: upcomingEnd },
      })
        .sort({ dueDate: 1 })
        .limit(10)
        .populate('tenant', 'fullName')
        .populate('property', 'name')
        .lean(),
    ]);

    const bedStatus = {
      available: 0,
      occupied: 0,
      reserved: 0,
      maintenance: 0,
    };
    let beds = 0;
    bedAgg.forEach((row) => {
      bedStatus[row._id] = row.count;
      beds += row.count;
    });

    const ticketMap = Object.fromEntries(ticketStatusAgg.map((s) => [s._id, s.count]));
    const openTickets =
      (ticketMap.open || 0) +
      (ticketMap.assigned || 0) +
      (ticketMap.in_progress || 0) +
      (ticketMap.reopened || 0);
    const awaitingConfirm = ticketMap.resolved_awaiting_confirmation || 0;

    const occMap = Object.fromEntries(
      occupancyAgg.map((o) => [o._id.toString(), o])
    );
    const occupancyByProperty = properties.map((p) => {
      const row = occMap[p._id.toString()] || { totalBeds: 0, occupiedBeds: 0 };
      return {
        propertyId: p._id,
        name: p.name,
        totalBeds: row.totalBeds,
        occupiedBeds: row.occupiedBeds,
        occupancyPct: row.totalBeds
          ? Math.round((row.occupiedBeds / row.totalBeds) * 100)
          : 0,
      };
    });

    const revMap = Object.fromEntries(
      revenueByMonth.map((r) => [`${r._id.y}-${r._id.m}`, r.total])
    );
    const expMap = Object.fromEntries(
      expenseByMonth.map((r) => [`${r._id.y}-${r._id.m}`, r.total])
    );
    const monthlyChart = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      monthlyChart.push({
        label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
        revenue: revMap[key] || 0,
        expense: expMap[key] || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totals: {
          properties: properties.length,
          floors,
          rooms,
          beds,
          occupiedBeds: bedStatus.occupied,
          availableBeds: bedStatus.available,
          reservedBeds: bedStatus.reserved,
          maintenanceBeds: bedStatus.maintenance,
          activeTenants,
          pendingRegistrations: pendingRegs,
          monthlyRentCollected: monthlyPayments[0]?.total || 0,
          pendingRent: pendingRent[0]?.total || 0,
          openTickets,
          ticketsAwaitingConfirmation: awaitingConfirm,
          monthlyExpenses: expensesMonth[0]?.total || 0,
        },
        occupancyByProperty,
        monthlyChart,
        recentTenants,
        recentTickets,
        upcomingRent,
      },
    });
  })
);

module.exports = router;
