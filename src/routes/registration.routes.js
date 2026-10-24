const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  RegistrationLink,
  RegistrationSubmission,
  Property,
  User,
  Tenant,
  Bed,
  TenantAssignment,
} = require('../models');
const { DEFAULT_FORM_CONFIG } = require('../models/RegistrationLink');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const {
  authenticate,
  requireStaff,
  requireAdmin,
  assertPropertyAccess,
  getAccessiblePropertyIds,
} = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');
const { writeAudit } = require('../services/auditService');
const { assignTenantToBed } = require('../services/assignmentService');

const router = express.Router();

function mergeFormConfig(input = {}) {
  const base = { ...DEFAULT_FORM_CONFIG, ...(input && typeof input === 'object' ? input : {}) };
  if (!Array.isArray(base.includedPropertyIds)) base.includedPropertyIds = [];
  return base;
}

function clientUrl(token) {
  return `${process.env.CLIENT_URL || 'http://localhost:5173'}/register/${token}`;
}

async function listPublicProperties(orgId, formConfig) {
  const query = { organization: orgId, isActive: true };
  const included = (formConfig.includedPropertyIds || []).filter(Boolean).map(String);
  if (included.length) query._id = { $in: included };

  const properties = await Property.find(query)
    .select('name address city facilities description defaultRentAmount')
    .sort({ name: 1 })
    .lean();

  return properties.map((p) => ({
    id: p._id,
    name: p.name,
    address: p.address,
    city: p.city,
    facilities: p.facilities || [],
    description: p.description,
    defaultRentAmount: p.defaultRentAmount,
  }));
}

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Try again later.' },
});

// Public: one form — properties come as a dropdown
router.get(
  '/public/:token',
  publicLimiter,
  asyncHandler(async (req, res) => {
    const link = await RegistrationLink.findOne({ token: req.params.token });
    if (!link || !link.isValidForUse()) {
      throw new AppError('Registration link is invalid or expired', 404);
    }

    const formConfig = mergeFormConfig(link.formConfig?.toObject?.() || link.formConfig);
    const properties = await listPublicProperties(link.organization, formConfig);

    res.json({
      success: true,
      data: {
        token: link.token,
        label: link.label,
        isMaster: Boolean(link.isMaster),
        formConfig,
        properties,
        expiresAt: link.expiresAt,
      },
    });
  })
);

router.post(
  '/public/:token',
  publicLimiter,
  asyncHandler(async (req, res) => {
    const link = await RegistrationLink.findOne({ token: req.params.token });
    if (!link || !link.isValidForUse()) {
      throw new AppError('Registration link is invalid or expired', 404);
    }

    const {
      propertyId,
      fullName,
      email,
      phone,
      gender,
      occupation,
      emergencyContact,
      preferredMoveInDate,
      preferredRoomType,
      preferredBed,
      additionalNotes,
    } = req.body;

    if (!propertyId) throw new AppError('Please select a property', 400);
    if (!fullName || !email || !phone) {
      throw new AppError('Full name, email, and phone are required', 400);
    }

    const formConfig = mergeFormConfig(link.formConfig?.toObject?.() || link.formConfig);
    const allowed = await listPublicProperties(link.organization, formConfig);
    const allowedIds = new Set(allowed.map((p) => String(p.id)));
    if (!allowedIds.has(String(propertyId))) {
      throw new AppError('Selected property is not available on this form', 400);
    }

    const property = await Property.findOne({
      _id: propertyId,
      organization: link.organization,
      isActive: true,
    });
    if (!property) throw new AppError('Property not found', 404);

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
    if (!emailOk) throw new AppError('Enter a valid email address', 400);

    const phoneDigits = String(phone).replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      throw new AppError('Enter a valid phone number (at least 10 digits)', 400);
    }

    if (formConfig.requireEmergencyContact) {
      if (!emergencyContact?.name || !emergencyContact?.phone) {
        throw new AppError('Emergency contact name and phone are required', 400);
      }
    }

    const emailNorm = email.toLowerCase().trim();
    const nameNorm = String(fullName).trim();
    const phoneNorm = String(phone).trim();

    // No approval — create login + tenant immediately. Admin only assigns room/bed.
    let user = await User.findOne({ email: emailNorm });
    let tempPassword;
    if (!user) {
      tempPassword = `Welcome@${Math.random().toString(36).slice(2, 8)}`;
      user = await User.create({
        organization: link.organization,
        email: emailNorm,
        passwordHash: await User.hashPassword(tempPassword),
        fullName: nameNorm,
        phone: phoneNorm,
        role: 'tenant',
      });
    } else if (user.role !== 'tenant') {
      throw new AppError('This email belongs to a staff account', 409);
    }

    let tenant = await Tenant.findOne({ user: user._id });
    if (!tenant) {
      tenant = await Tenant.create({
        organization: link.organization,
        user: user._id,
        property: property._id,
        fullName: nameNorm,
        email: emailNorm,
        phone: phoneNorm,
        emergencyContact,
        status: 'pending',
        registrationStatus: 'approved',
        preferredRoomType,
        preferredBed,
        moveInDate: preferredMoveInDate,
      });
    } else {
      tenant.property = property._id;
      tenant.fullName = nameNorm;
      tenant.phone = phoneNorm;
      tenant.registrationStatus = 'approved';
      if (tenant.status === 'inactive') tenant.status = 'pending';
      await tenant.save();
    }

    const submission = await RegistrationSubmission.create({
      organization: link.organization,
      registrationLink: link._id,
      property: property._id,
      fullName: nameNorm,
      email: emailNorm,
      phone: phoneNorm,
      gender: gender || undefined,
      occupation: occupation || undefined,
      emergencyContact,
      preferredMoveInDate,
      preferredRoomType,
      preferredBed,
      additionalNotes,
      status: 'approved',
      tenant: tenant._id,
      reviewedAt: new Date(),
    });

    link.useCount += 1;
    await link.save();

    const admins = await User.find({
      organization: link.organization,
      role: 'org_admin',
      isActive: true,
    });
    for (const admin of admins) {
      await createNotification({
        organization: link.organization,
        user: admin._id,
        type: 'registration',
        title: 'New tenant joined',
        body: `${nameNorm} joined ${property.name}. Assign a room & bed.`,
        link: `/admin/registrations`,
        meta: { submissionId: submission._id, tenantId: tenant._id },
      });
    }

    await createNotification({
      organization: link.organization,
      user: user._id,
      type: 'registration',
      title: 'Welcome to Has Tracker',
      body: 'Your account is ready. Sign in anytime — room assignment comes next.',
      link: '/tenant',
    });

    res.status(201).json({
      success: true,
      message: 'Registered successfully',
      data: {
        id: submission._id,
        status: submission.status,
        tenantId: tenant._id,
        email: emailNorm,
        tempPassword: tempPassword || undefined,
      },
    });
  })
);

router.use(authenticate, requireStaff);

/** Ensure / return the single master registration form for this org */
async function getOrCreateMaster(req) {
  let link = await RegistrationLink.findOne({
    organization: req.auth.organizationId,
    isMaster: true,
  });

  if (!link) {
    // Promote newest existing link, or create fresh master
    link = await RegistrationLink.findOne({ organization: req.auth.organizationId }).sort({
      createdAt: -1,
    });
    if (link) {
      link.isMaster = true;
      link.property = undefined;
      link.label = link.label || 'Master application form';
      link.formConfig = mergeFormConfig(link.formConfig?.toObject?.() || link.formConfig);
      await link.save();
    } else {
      link = await RegistrationLink.create({
        organization: req.auth.organizationId,
        isMaster: true,
        label: 'Master application form',
        formConfig: mergeFormConfig({}),
        createdBy: req.user._id,
        isActive: true,
      });
    }
  }

  return link;
}

router.get(
  '/form',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const link = await getOrCreateMaster(req);
    const properties = await Property.find({
      organization: req.auth.organizationId,
      isActive: true,
    })
      .select('name address city defaultRentAmount isActive')
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      data: link,
      url: clientUrl(link.token),
      properties,
    });
  })
);

router.patch(
  '/form',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const link = await getOrCreateMaster(req);

    ['label', 'isActive', 'maxRent', 'minRent'].forEach((f) => {
      if (req.body[f] !== undefined) link[f] = req.body[f];
    });
    if (req.body.expiresAt !== undefined) {
      link.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined;
    }
    if (req.body.maxUses !== undefined) {
      link.maxUses =
        req.body.maxUses === '' || req.body.maxUses == null
          ? null
          : Number(req.body.maxUses);
    }
    if (req.body.formConfig !== undefined) {
      const prev = link.formConfig?.toObject?.() || link.formConfig || {};
      const next = mergeFormConfig({ ...prev, ...req.body.formConfig });
      if (req.body.formConfig.includedPropertyIds !== undefined) {
        next.includedPropertyIds = Array.isArray(req.body.formConfig.includedPropertyIds)
          ? req.body.formConfig.includedPropertyIds
          : [];
      }
      link.formConfig = next;
      link.markModified('formConfig');
    }

    link.isMaster = true;
    link.property = undefined;
    await link.save();

    res.json({
      success: true,
      data: link,
      url: clientUrl(link.token),
    });
  })
);

router.get(
  '/links',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const links = await RegistrationLink.find(query)
      .populate('property', 'name')
      .sort({ isMaster: -1, createdAt: -1 });
    res.json({ success: true, data: links });
  })
);

router.post(
  '/links',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Always return/create the single master form instead of many links
    const link = await getOrCreateMaster(req);
    res.status(201).json({ success: true, data: link, url: clientUrl(link.token) });
  })
);

router.patch(
  '/links/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const link = await RegistrationLink.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!link) throw new AppError('Link not found', 404);

    ['label', 'isActive', 'maxRent', 'minRent'].forEach((f) => {
      if (req.body[f] !== undefined) link[f] = req.body[f];
    });
    if (req.body.expiresAt !== undefined) {
      link.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined;
    }
    if (req.body.maxUses !== undefined) {
      link.maxUses =
        req.body.maxUses === '' || req.body.maxUses == null
          ? null
          : Number(req.body.maxUses);
    }
    if (req.body.formConfig !== undefined) {
      link.formConfig = mergeFormConfig({
        ...(link.formConfig?.toObject?.() || link.formConfig || {}),
        ...req.body.formConfig,
      });
      link.markModified('formConfig');
    }
    await link.save();
    res.json({
      success: true,
      data: link,
      url: clientUrl(link.token),
    });
  })
);

router.get(
  '/submissions',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) query.property = req.query.propertyId;
    if (req.query.status) query.status = req.query.status;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      RegistrationSubmission.find(query)
        .populate('property', 'name')
        .populate('registrationLink', 'label token isMaster')
        .populate('tenant', 'fullName status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      RegistrationSubmission.countDocuments(query),
    ]);

    const tenantIds = items.map((s) => s.tenant?._id || s.tenant).filter(Boolean);
    const assignments = await TenantAssignment.find({
      tenant: { $in: tenantIds },
      isActive: true,
    })
      .populate('room', 'roomNumber')
      .populate('bed', 'bedNumber label')
      .lean();
    const byTenant = Object.fromEntries(
      assignments.map((a) => [String(a.tenant), a])
    );

    const data = items.map((s) => {
      const tid = s.tenant?._id || s.tenant;
      const assignment = tid ? byTenant[String(tid)] : null;
      return {
        ...s,
        assignment: assignment
          ? {
              roomNumber: assignment.room?.roomNumber,
              bedNumber: assignment.bed?.label || assignment.bed?.bedNumber,
            }
          : null,
        needsBed: Boolean(tid) && !assignment,
      };
    });

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  })
);

/** Admin only picks room/bed — no approve/reject step */
router.post(
  '/submissions/:id/assign-bed',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { bedId, moveInDate, rentAmount } = req.body;
    if (!bedId) throw new AppError('Select a room & bed', 400);

    const submission = await RegistrationSubmission.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!submission) throw new AppError('Application not found', 404);

    let tenant = submission.tenant
      ? await Tenant.findOne({
          _id: submission.tenant,
          organization: req.auth.organizationId,
        })
      : null;

    if (!tenant) {
      let user = await User.findOne({ email: submission.email });
      if (!user) {
        const tempPassword = `Welcome@${Math.random().toString(36).slice(2, 8)}`;
        user = await User.create({
          organization: req.auth.organizationId,
          email: submission.email,
          passwordHash: await User.hashPassword(tempPassword),
          fullName: submission.fullName,
          phone: submission.phone,
          role: 'tenant',
        });
      } else if (user.role !== 'tenant') {
        throw new AppError('Email belongs to a staff account', 409);
      }
      tenant = await Tenant.findOne({ user: user._id });
      if (!tenant) {
        tenant = await Tenant.create({
          organization: req.auth.organizationId,
          user: user._id,
          property: submission.property,
          fullName: submission.fullName,
          email: submission.email,
          phone: submission.phone,
          emergencyContact: submission.emergencyContact,
          status: 'pending',
          registrationStatus: 'approved',
          preferredRoomType: submission.preferredRoomType,
          preferredBed: submission.preferredBed,
          moveInDate: submission.preferredMoveInDate,
        });
      }
      submission.tenant = tenant._id;
      submission.status = 'approved';
      await submission.save();
    }

    const bed = await Bed.findOne({
      _id: bedId,
      organization: req.auth.organizationId,
      isActive: true,
    });
    if (!bed) throw new AppError('Bed not found', 404);
    assertPropertyAccess(req, bed.property);

    const assignment = await assignTenantToBed({
      organizationId: req.auth.organizationId,
      tenantId: tenant._id,
      bedId,
      moveInDate: moveInDate ? new Date(moveInDate) : new Date(),
      rentAmount: rentAmount != null ? Number(rentAmount) : undefined,
      createdBy: req.user._id,
      req,
    });

    if (tenant.user) {
      await createNotification({
        organization: req.auth.organizationId,
        user: tenant.user,
        type: 'registration',
        title: 'Room assigned',
        body: 'Your room and bed have been assigned. Check My Room in the app.',
        link: '/tenant/room',
      });
    }

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'registration.assign_bed',
      entityType: 'RegistrationSubmission',
      entityId: submission._id,
      after: { tenantId: tenant._id, bedId },
      req,
    });

    res.json({
      success: true,
      message: 'Room & bed assigned',
      data: { submission, tenant, assignment },
    });
  })
);

module.exports = router;
