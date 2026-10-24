const mongoose = require('mongoose');
const {
  Bed,
  Tenant,
  TenantAssignment,
  SecurityDeposit,
} = require('../models');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');

async function supportsTransactions() {
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    return Boolean(info.setName);
  } catch {
    return false;
  }
}

async function assignTenantToBedCore({
  organizationId,
  tenantId,
  bedId,
  moveInDate,
  rentAmount,
  securityDepositAmount = 0,
  createdBy,
  session = null,
}) {
  const opts = session ? { session } : {};

  const tenant = await Tenant.findOne({
    _id: tenantId,
    organization: organizationId,
  }).session(session || null);

  if (!tenant) throw new AppError('Tenant not found', 404);

  const bed = await Bed.findOne({
    _id: bedId,
    organization: organizationId,
    isActive: true,
  }).session(session || null);

  if (!bed) throw new AppError('Bed not found', 404);
  if (bed.status === 'maintenance') {
    throw new AppError('Bed is under maintenance', 409);
  }

  const current = await TenantAssignment.findOne({
    tenant: tenantId,
    isActive: true,
  }).session(session || null);

  if (current) {
    current.isActive = false;
    current.moveOutDate = moveInDate || new Date();
    await current.save(opts);
    await Bed.findByIdAndUpdate(current.bed, { status: 'available' }, opts);
  }

  const existingBedAssignment = await TenantAssignment.findOne({
    bed: bedId,
    isActive: true,
  }).session(session || null);

  if (existingBedAssignment) {
    throw new AppError(
      'This bed already has an active tenant assignment for overlapping dates',
      409
    );
  }

  const created = await TenantAssignment.create(
    [
      {
        organization: organizationId,
        tenant: tenantId,
        property: bed.property,
        floor: bed.floor,
        room: bed.room,
        bed: bedId,
        moveInDate: moveInDate || new Date(),
        rentAmount: rentAmount ?? tenant.agreedRent ?? bed.rentAmount ?? 0,
        isActive: true,
        createdBy,
      },
    ],
    opts
  );

  const assignment = created[0];

  bed.status = 'occupied';
  await bed.save(opts);

  tenant.status = 'active';
  tenant.property = bed.property;
  tenant.agreedRent = assignment.rentAmount;
  tenant.moveInDate = assignment.moveInDate;
  if (securityDepositAmount > 0) {
    tenant.securityDeposit = securityDepositAmount;
  }
  tenant.registrationStatus = 'approved';
  await tenant.save(opts);

  if (securityDepositAmount > 0) {
    await SecurityDeposit.findOneAndUpdate(
      { tenant: tenantId },
      {
        organization: organizationId,
        tenant: tenantId,
        property: bed.property,
        amount: securityDepositAmount,
        amountHeld: securityDepositAmount,
        status: 'held',
        collectedAt: new Date(),
      },
      { upsert: true, new: true, ...opts }
    );
  }

  return assignment;
}

async function assignTenantToBed({
  organizationId,
  tenantId,
  bedId,
  moveInDate,
  rentAmount,
  securityDepositAmount = 0,
  createdBy,
  req,
}) {
  const useTxn = await supportsTransactions();

  try {
    let assignment;
    if (useTxn) {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        assignment = await assignTenantToBedCore({
          organizationId,
          tenantId,
          bedId,
          moveInDate,
          rentAmount,
          securityDepositAmount,
          createdBy,
          session,
        });
        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    } else {
      assignment = await assignTenantToBedCore({
        organizationId,
        tenantId,
        bedId,
        moveInDate,
        rentAmount,
        securityDepositAmount,
        createdBy,
      });
    }

    await writeAudit({
      organization: organizationId,
      actor: createdBy,
      action: 'tenant.assign_bed',
      entityType: 'TenantAssignment',
      entityId: assignment._id,
      after: assignment.toObject(),
      req,
    });

    return assignment;
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(
        'This bed already has an active tenant assignment (concurrent conflict)',
        409
      );
    }
    throw err;
  }
}

async function checkoutTenant({ organizationId, tenantId, moveOutDate, actorId, req }) {
  const useTxn = await supportsTransactions();
  const run = async (session = null) => {
    const opts = session ? { session } : {};
    const tenant = await Tenant.findOne({
      _id: tenantId,
      organization: organizationId,
    }).session(session || null);
    if (!tenant) throw new AppError('Tenant not found', 404);

    const assignment = await TenantAssignment.findOne({
      tenant: tenantId,
      isActive: true,
    }).session(session || null);

    if (assignment) {
      assignment.isActive = false;
      assignment.moveOutDate = moveOutDate || new Date();
      await assignment.save(opts);
      await Bed.findByIdAndUpdate(assignment.bed, { status: 'available' }, opts);
    }

    tenant.status = 'checked_out';
    tenant.moveOutDate = moveOutDate || new Date();
    await tenant.save(opts);
    return tenant;
  };

  let tenant;
  if (useTxn) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      tenant = await run(session);
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } else {
    tenant = await run();
  }

  await writeAudit({
    organization: organizationId,
    actor: actorId,
    action: 'tenant.checkout',
    entityType: 'Tenant',
    entityId: tenantId,
    req,
  });

  return tenant;
}

module.exports = { assignTenantToBed, checkoutTenant };
