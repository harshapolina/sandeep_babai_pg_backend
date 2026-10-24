const express = require('express');
const { Announcement, Tenant } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');
const { sendAnnouncementEmail, getMailConfig } = require('../services/emailService');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = {
      organization: req.auth.organizationId,
      isActive: true,
    };

    if (req.user.role === 'tenant' && req.tenant?.property) {
      query.$or = [
        { scope: 'all' },
        { properties: req.tenant.property },
      ];
    }

    const items = await Announcement.find(query)
      .populate('properties', 'name')
      .populate('createdBy', 'fullName')
      .sort({ publishedAt: -1 })
      .limit(50);

    res.json({ success: true, data: items });
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { title, body, category, scope, propertyIds, expiresAt, notify } = req.body;
    if (!title || !body) throw new AppError('Title and body are required', 400);

    const announcement = await Announcement.create({
      organization: req.auth.organizationId,
      title,
      body,
      category: category || 'general',
      scope: scope === 'selected' ? 'selected' : 'all',
      properties: scope === 'selected' ? propertyIds || [] : [],
      createdBy: req.user._id,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    let emailStats = { attempted: 0, sent: 0, failed: 0 };

    if (notify !== false) {
      const tenantQuery = {
        organization: req.auth.organizationId,
        status: { $in: ['active', 'pending'] },
      };
      if (announcement.scope === 'selected' && announcement.properties.length) {
        tenantQuery.property = { $in: announcement.properties };
      }
      const tenants = await Tenant.find(tenantQuery).select('user fullName email');
      const mailCfg = await getMailConfig(req.auth.organizationId);

      for (const t of tenants) {
        if (!t.user) continue;

        // Prefer dedicated announcement email (from Settings SMTP / app name)
        let mailResult = { attempted: false, sent: false };
        if (mailCfg.enabled && t.email) {
          mailResult = await sendAnnouncementEmail({
            organizationId: req.auth.organizationId,
            to: t.email,
            tenantName: t.fullName,
            title: announcement.title,
            body: announcement.body,
          });
          emailStats.attempted += 1;
          if (mailResult.sent) emailStats.sent += 1;
          else emailStats.failed += 1;
        }

        await createNotification({
          organization: req.auth.organizationId,
          user: t.user,
          type: 'announcement',
          title: announcement.title,
          body: announcement.body.slice(0, 160),
          link: '/tenant/announcements',
          meta: { announcementId: announcement._id },
          // Already emailed above when configured — avoid double send
          sendMail: !mailResult.sent,
          emailSubject: `${mailCfg.appName || 'Has Tracker'}: ${announcement.title}`,
        });
      }
    }

    res.status(201).json({
      success: true,
      data: announcement,
      email: emailStats,
      message:
        emailStats.sent > 0
          ? `Published · emailed ${emailStats.sent} tenant(s)`
          : 'Published · in-app only (configure SMTP in Settings to email)',
    });
  })
);

router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const item = await Announcement.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!item) throw new AppError('Announcement not found', 404);

    ['title', 'body', 'category', 'scope', 'isActive', 'expiresAt'].forEach((f) => {
      if (req.body[f] !== undefined) item[f] = req.body[f];
    });
    if (req.body.propertyIds) item.properties = req.body.propertyIds;
    await item.save();
    res.json({ success: true, data: item });
  })
);

module.exports = router;
