const nodemailer = require('nodemailer');
const { Organization } = require('../models');

function envMailFallback() {
  if (process.env.EMAIL_ENABLED !== 'true') return null;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return {
    enabled: true,
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.EMAIL_FROM_NAME || process.env.EMAIL_FROM || 'Has Tracker',
    fromEmail: process.env.EMAIL_FROM || process.env.SMTP_USER,
    appName: process.env.APP_NAME || 'Has Tracker',
  };
}

async function getMailConfig(organizationId) {
  if (!organizationId) return envMailFallback();

  const org = await Organization.findById(organizationId)
    .select('+settings.mail.pass name settings')
    .lean();

  const mail = org?.settings?.mail || {};
  const appName = org?.settings?.appName || org?.name || 'Has Tracker';

  if (mail.enabled && mail.host && mail.user && mail.pass) {
    return {
      enabled: true,
      host: mail.host,
      port: Number(mail.port || 587),
      secure: Boolean(mail.secure),
      user: mail.user,
      pass: mail.pass,
      fromName: mail.fromName || appName,
      fromEmail: mail.fromEmail || mail.user,
      appName,
    };
  }

  const fallback = envMailFallback();
  if (fallback) return { ...fallback, appName: fallback.appName || appName };
  return {
    enabled: false,
    appName,
    reason: 'Mail is not configured. Add SMTP details in Settings.',
  };
}

function buildTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
}

/**
 * Send an email using org Settings SMTP (or .env fallback).
 * @returns {{ sent: boolean, attempted: boolean, reason?: string, messageId?: string }}
 */
async function sendEmail({ organizationId, to, subject, text, html }) {
  const cfg = await getMailConfig(organizationId);
  if (!cfg.enabled) {
    return {
      attempted: false,
      sent: false,
      reason: cfg.reason || 'Email disabled',
    };
  }
  if (!to) {
    return { attempted: false, sent: false, reason: 'No recipient' };
  }

  try {
    const transport = buildTransport(cfg);
    const from = `"${cfg.fromName || cfg.appName}" <${cfg.fromEmail || cfg.user}>`;
    const info = await transport.sendMail({
      from,
      to,
      subject: subject || `${cfg.appName} notification`,
      text,
      html: html || undefined,
    });
    return {
      attempted: true,
      sent: true,
      messageId: info.messageId,
    };
  } catch (err) {
    return {
      attempted: true,
      sent: false,
      reason: err.message || 'SMTP send failed',
    };
  }
}

async function sendAnnouncementEmail({
  organizationId,
  to,
  tenantName,
  title,
  body,
}) {
  const cfg = await getMailConfig(organizationId);
  const app = cfg.appName || 'Has Tracker';
  const subject = `${app}: ${title}`;
  const text = `Hi ${tenantName || 'there'},\n\n${title}\n\n${body}\n\n— ${app}`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1C1917">
      <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#78716C">${app}</p>
      <h1 style="font-size:22px;margin:8px 0 16px">${escapeHtml(title)}</h1>
      <p style="font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(body)}</p>
      <p style="margin-top:28px;font-size:12px;color:#78716C">Sent by ${escapeHtml(app)}</p>
    </div>
  `;
  return sendEmail({ organizationId, to, subject, text, html });
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function verifyMailConnection(organizationId) {
  const cfg = await getMailConfig(organizationId);
  if (!cfg.enabled) {
    return { ok: false, message: cfg.reason || 'Mail not configured' };
  }
  try {
    const transport = buildTransport(cfg);
    await transport.verify();
    return { ok: true, message: `Connected to ${cfg.host} as ${cfg.user}` };
  } catch (err) {
    return { ok: false, message: err.message || 'Connection failed' };
  }
}

module.exports = {
  getMailConfig,
  sendEmail,
  sendAnnouncementEmail,
  verifyMailConnection,
};
