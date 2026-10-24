const express = require('express');
const {
  MaintenanceTicket,
  TicketComment,
  TicketAttachment,
  TenantAssignment,
  User,
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
const { generateTicketNumber } = require('../utils/ticketNumber');
const { createNotification } = require('../services/notificationService');
const { writeAudit } = require('../services/auditService');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(authenticate);

// Tenant: create ticket
router.post(
  '/tenant',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'tenant' || !req.tenant) {
      throw new AppError('Tenant access required', 403);
    }

    const assignment = await TenantAssignment.findOne({
      tenant: req.tenant._id,
      isActive: true,
    });
    if (!assignment) throw new AppError('No active room assignment', 400);

    const { category, title, description, priority } = req.body;
    if (!category || !title || !description) {
      throw new AppError('Category, title, and description are required', 400);
    }

    const ticket = await MaintenanceTicket.create({
      organization: req.auth.organizationId,
      ticketNumber: await generateTicketNumber(),
      tenant: req.tenant._id,
      property: assignment.property,
      room: assignment.room,
      bed: assignment.bed,
      category,
      title,
      description,
      priority: priority || 'medium',
      status: 'open',
    });

    const admins = await User.find({
      organization: req.auth.organizationId,
      role: { $in: ['org_admin', 'property_manager', 'maintenance_staff'] },
      isActive: true,
    });
    for (const admin of admins) {
      await createNotification({
        organization: req.auth.organizationId,
        user: admin._id,
        type: 'ticket',
        title: 'New maintenance ticket',
        body: `${ticket.ticketNumber}: ${title}`,
        link: `/admin/tickets/${ticket._id}`,
      });
    }

    res.status(201).json({ success: true, data: ticket });
  })
);

// Tenant: list own tickets
router.get(
  '/tenant',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'tenant' || !req.tenant) {
      throw new AppError('Tenant access required', 403);
    }

    const tickets = await MaintenanceTicket.find({ tenant: req.tenant._id })
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'fullName')
      .populate('property', 'name');
    res.json({ success: true, data: tickets });
  })
);

router.get(
  '/tenant/:id',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'tenant' || !req.tenant) {
      throw new AppError('Tenant access required', 403);
    }

    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      tenant: req.tenant._id,
    })
      .populate('assignedTo', 'fullName role')
      .populate('property', 'name')
      .populate('room', 'roomNumber');

    if (!ticket) throw new AppError('Ticket not found', 404);

    const comments = await TicketComment.find({
      ticket: ticket._id,
      isInternal: false,
    })
      .populate('author', 'fullName role')
      .sort({ createdAt: 1 });

    res.json({ success: true, data: { ticket, comments } });
  })
);

router.post(
  '/tenant/:id/confirm',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'tenant' || !req.tenant) {
      throw new AppError('Tenant access required', 403);
    }

    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      tenant: req.tenant._id,
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (ticket.status !== 'resolved_awaiting_confirmation') {
      throw new AppError('Ticket is not awaiting confirmation', 400);
    }

    ticket.status = 'closed';
    ticket.tenantConfirmedAt = new Date();
    ticket.closedAt = new Date();
    await ticket.save();

    res.json({ success: true, data: ticket });
  })
);

router.post(
  '/tenant/:id/reopen',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'tenant' || !req.tenant) {
      throw new AppError('Tenant access required', 403);
    }
    if (!req.body.reason) throw new AppError('Reopen reason is required', 400);

    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      tenant: req.tenant._id,
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (!['resolved_awaiting_confirmation', 'closed'].includes(ticket.status)) {
      throw new AppError('Ticket cannot be reopened from current status', 400);
    }

    ticket.status = 'reopened';
    ticket.reopenReason = req.body.reason;
    ticket.tenantConfirmedAt = undefined;
    ticket.closedAt = undefined;
    await ticket.save();

    await TicketComment.create({
      organization: req.auth.organizationId,
      ticket: ticket._id,
      author: req.user._id,
      body: `Reopened: ${req.body.reason}`,
    });

    res.json({ success: true, data: ticket });
  })
);

router.post(
  '/tenant/:id/comments',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'tenant' || !req.tenant) {
      throw new AppError('Tenant access required', 403);
    }
    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      tenant: req.tenant._id,
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (!req.body.body) throw new AppError('Comment body required', 400);

    const comment = await TicketComment.create({
      organization: req.auth.organizationId,
      ticket: ticket._id,
      author: req.user._id,
      body: req.body.body,
      isInternal: false,
    });

    res.status(201).json({ success: true, data: comment });
  })
);

// Staff routes below
router.get(
  '/',
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
    if (req.query.category) query.category = req.query.category;
    if (req.query.assignedTo === 'me') query.assignedTo = req.user._id;
    if (req.query.assignedTo && req.query.assignedTo !== 'me') {
      query.assignedTo = req.query.assignedTo;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const orgId = req.auth.organizationId;

    const itemsPromise = MaintenanceTicket.find(query)
      .select(
        'ticketNumber title description category priority status tenant property room assignedTo createdAt updatedAt'
      )
      .populate('tenant', 'fullName')
      .populate('property', 'name')
      .populate('assignedTo', 'fullName')
      .populate('room', 'roomNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const countsPromise = MaintenanceTicket.aggregate([
      { $match: { organization: orgId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const [items, statusCounts] = await Promise.all([itemsPromise, countsPromise]);

    res.json({
      success: true,
      data: items,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.count])),
      pagination: { page, limit, total: items.length, pages: page },
    });
  })
);

router.get(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    })
      .populate('tenant', 'fullName email phone')
      .populate('property', 'name')
      .populate('room', 'roomNumber')
      .populate('bed', 'bedNumber')
      .populate('assignedTo', 'fullName role')
      .lean();

    if (!ticket) throw new AppError('Ticket not found', 404);
    assertPropertyAccess(req, ticket.property?._id || ticket.property);

    const [comments, attachments] = await Promise.all([
      TicketComment.find({ ticket: ticket._id })
        .populate('author', 'fullName role')
        .sort({ createdAt: 1 })
        .lean(),
      TicketAttachment.find({ ticket: ticket._id }).select('fileName mimeType createdAt').lean(),
    ]);

    res.json({ success: true, data: { ticket, comments, attachments } });
  })
);

router.patch(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    }).populate('tenant');
    if (!ticket) throw new AppError('Ticket not found', 404);
    assertPropertyAccess(req, ticket.property);

    const before = ticket.toObject();
    const { status, assignedTo, priority, resolutionNotes } = req.body;

    if (assignedTo !== undefined) {
      ticket.assignedTo = assignedTo;
      ticket.assignedAt = new Date();
      if (ticket.status === 'open') ticket.status = 'assigned';
      if (!ticket.firstResponseAt) ticket.firstResponseAt = new Date();
    }

    if (priority) ticket.priority = priority;

    if (status) {
      ticket.status = status;
      if (status === 'in_progress' && !ticket.firstResponseAt) {
        ticket.firstResponseAt = new Date();
      }
      if (status === 'resolved_awaiting_confirmation') {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = req.user._id;
        if (resolutionNotes) ticket.resolutionNotes = resolutionNotes;

        const tenantUser = ticket.tenant?.user;
        if (tenantUser) {
          await createNotification({
            organization: req.auth.organizationId,
            user: tenantUser,
            type: 'ticket',
            title: 'Ticket marked resolved',
            body: `${ticket.ticketNumber} is resolved. Please confirm or reopen.`,
            link: `/tenant/tickets/${ticket._id}`,
          });
        }
      }
      if (status === 'closed') {
        if (req.user.role !== 'org_admin' && !ticket.tenantConfirmedAt) {
          throw new AppError(
            'Only admin can override-close without tenant confirmation',
            403
          );
        }
        if (!ticket.tenantConfirmedAt) {
          ticket.adminOverrideClose = true;
          ticket.overrideReason = req.body.overrideReason || 'Admin override close';
        }
        ticket.closedAt = new Date();
        ticket.closedBy = req.user._id;
      }
    }

    if (resolutionNotes && !status) ticket.resolutionNotes = resolutionNotes;
    await ticket.save();

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'ticket.update',
      entityType: 'MaintenanceTicket',
      entityId: ticket._id,
      before,
      after: ticket.toObject(),
      req,
    });

    res.json({ success: true, data: ticket });
  })
);

router.post(
  '/:id/comments',
  requireStaff,
  asyncHandler(async (req, res) => {
    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    }).populate('tenant');
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (!req.body.body) throw new AppError('Comment body required', 400);

    const comment = await TicketComment.create({
      organization: req.auth.organizationId,
      ticket: ticket._id,
      author: req.user._id,
      body: req.body.body,
      isInternal: Boolean(req.body.isInternal),
    });

    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date();
      await ticket.save();
    }

    if (!comment.isInternal && ticket.tenant?.user) {
      await createNotification({
        organization: req.auth.organizationId,
        user: ticket.tenant.user,
        type: 'ticket',
        title: 'New reply on your ticket',
        body: `${ticket.ticketNumber}: staff replied`,
        link: `/tenant/tickets/${ticket._id}`,
      });
    }

    res.status(201).json({ success: true, data: comment });
  })
);

router.post(
  '/:id/attachments',
  requireStaff,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const ticket = await MaintenanceTicket.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (!req.file) throw new AppError('File required', 400);

    const attachment = await TicketAttachment.create({
      organization: req.auth.organizationId,
      ticket: ticket._id,
      uploadedBy: req.user._id,
      key: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });

    res.status(201).json({ success: true, data: attachment });
  })
);

module.exports = router;
