const { AuditLog } = require('../models');

async function writeAudit({
  organization,
  actor,
  action,
  entityType,
  entityId,
  before,
  after,
  req,
}) {
  try {
    await AuditLog.create({
      organization,
      actor,
      action,
      entityType,
      entityId,
      before,
      after,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = { writeAudit };
