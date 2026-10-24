const express = require('express');
const { Organization } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { authenticate, requireAdmin, requireStaff } = require('../middleware/auth');
const {
  verifyMailConnection,
  sendEmail,
  getMailConfig,
} = require('../services/emailService');

const router = express.Router();
router.use(authenticate, requireStaff);

function publicSettings(org) {
  const s = org.settings || {};
  const mail = s.mail || {};
  const bot = s.chatbot || {};
  return {
    name: org.name,
    legalName: org.legalName,
    email: org.email,
    phone: org.phone,
    address: org.address,
    city: org.city,
    state: org.state,
    country: org.country,
    settings: {
      appName: s.appName || org.name || 'Has Tracker',
      defaultRentDueDay: s.defaultRentDueDay ?? 5,
      currency: s.currency || 'INR',
      timezone: s.timezone || 'Asia/Kolkata',
      autoApproveRegistrations: s.autoApproveRegistrations !== false,
      ticketCategories: s.ticketCategories || [],
      mail: {
        enabled: Boolean(mail.enabled),
        host: mail.host || '',
        port: mail.port || 587,
        secure: Boolean(mail.secure),
        user: mail.user || '',
        fromName: mail.fromName || '',
        fromEmail: mail.fromEmail || '',
        hasPassword: Boolean(mail.pass),
        // never return raw password
        pass: mail.pass ? '********' : '',
      },
      chatbot: {
        enabled: bot.enabled !== false,
        provider: bot.provider || 'auto',
        model: bot.model || '',
        hasApiKey: Boolean(bot.hasApiKey || bot.apiKey),
        apiKey: bot.apiKey ? '********' : '',
      },
    },
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const org = await Organization.findById(req.auth.organizationId).select(
      '+settings.mail.pass +settings.chatbot.apiKey'
    );
    if (!org) throw new AppError('Organization not found', 404);
    res.json({ success: true, data: publicSettings(org) });
  })
);

router.patch(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const org = await Organization.findById(req.auth.organizationId).select(
      '+settings.mail.pass +settings.chatbot.apiKey'
    );
    if (!org) throw new AppError('Organization not found', 404);

    ['name', 'legalName', 'email', 'phone', 'address', 'city', 'state', 'country'].forEach(
      (f) => {
        if (req.body[f] !== undefined) org[f] = req.body[f];
      }
    );

    if (!org.settings) org.settings = {};
    const incoming = req.body.settings || {};

    if (incoming.appName !== undefined) org.settings.appName = incoming.appName;
    if (incoming.defaultRentDueDay !== undefined) {
      org.settings.defaultRentDueDay = Number(incoming.defaultRentDueDay) || 5;
    }
    if (incoming.currency !== undefined) org.settings.currency = incoming.currency;
    if (incoming.timezone !== undefined) org.settings.timezone = incoming.timezone;
    if (incoming.autoApproveRegistrations !== undefined) {
      org.settings.autoApproveRegistrations = Boolean(incoming.autoApproveRegistrations);
    }
    if (Array.isArray(incoming.ticketCategories)) {
      org.settings.ticketCategories = incoming.ticketCategories
        .map((c) => String(c).trim())
        .filter(Boolean);
    }

    if (incoming.mail) {
      if (!org.settings.mail) org.settings.mail = {};
      const m = incoming.mail;
      if (m.enabled !== undefined) org.settings.mail.enabled = Boolean(m.enabled);
      if (m.host !== undefined) org.settings.mail.host = String(m.host).trim();
      if (m.port !== undefined) org.settings.mail.port = Number(m.port) || 587;
      if (m.secure !== undefined) org.settings.mail.secure = Boolean(m.secure);
      if (m.user !== undefined) org.settings.mail.user = String(m.user).trim();
      if (m.fromName !== undefined) org.settings.mail.fromName = String(m.fromName).trim();
      if (m.fromEmail !== undefined) {
        org.settings.mail.fromEmail = String(m.fromEmail).trim().toLowerCase();
      }
      // Only update password when user typed a new one (not the mask)
      if (
        m.pass !== undefined &&
        m.pass !== '' &&
        m.pass !== '********' &&
        !/^\*+$/.test(m.pass)
      ) {
        org.settings.mail.pass = String(m.pass);
      }
    }

    if (incoming.chatbot) {
      if (!org.settings.chatbot) org.settings.chatbot = {};
      const c = incoming.chatbot;
      if (c.enabled !== undefined) org.settings.chatbot.enabled = Boolean(c.enabled);
      if (c.provider !== undefined) org.settings.chatbot.provider = c.provider;
      if (c.model !== undefined) org.settings.chatbot.model = String(c.model).trim();
      if (
        c.apiKey !== undefined &&
        c.apiKey !== '' &&
        c.apiKey !== '********' &&
        !/^\*+$/.test(c.apiKey)
      ) {
        org.settings.chatbot.apiKey = String(c.apiKey).trim();
        org.settings.chatbot.hasApiKey = true;
      }
    }

    org.markModified('settings');
    await org.save();

    const fresh = await Organization.findById(org._id).select(
      '+settings.mail.pass +settings.chatbot.apiKey'
    );
    res.json({ success: true, data: publicSettings(fresh) });
  })
);

router.post(
  '/mail/test',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const verify = await verifyMailConnection(req.auth.organizationId);
    if (!verify.ok) {
      throw new AppError(verify.message, 400);
    }

    const to = req.body.to || req.user.email;
    const cfg = await getMailConfig(req.auth.organizationId);
    const result = await sendEmail({
      organizationId: req.auth.organizationId,
      to,
      subject: `${cfg.appName || 'Has Tracker'} — test email`,
      text: `This is a test email from ${cfg.appName || 'your PG platform'}. SMTP is working.`,
    });

    if (!result.sent) {
      throw new AppError(result.reason || 'Failed to send test email', 400);
    }

    res.json({
      success: true,
      message: `Test email sent to ${to}`,
      data: { to, messageId: result.messageId },
    });
  })
);

module.exports = router;
