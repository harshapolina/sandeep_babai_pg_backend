const express = require('express');
const { Room, Bed, Floor, TenantAssignment } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const {
  authenticate,
  requireStaff,
  requireAdmin,
  assertPropertyAccess,
  getAccessiblePropertyIds,
} = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireStaff);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId, isActive: true };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query.property = { $in: allowed };
    if (req.query.propertyId) {
      assertPropertyAccess(req, req.query.propertyId);
      query.property = req.query.propertyId;
    }
    if (req.query.floorId) query.floor = req.query.floorId;
    if (req.query.q) {
      query.roomNumber = new RegExp(req.query.q, 'i');
    }

    const rooms = await Room.find(query)
      .populate('floor', 'name level')
      .populate('property', 'name')
      .sort({ roomNumber: 1 })
      .lean();

    if (!rooms.length) {
      return res.json({ success: true, data: [] });
    }

    const roomIds = rooms.map((r) => r._id);
    const allBeds = await Bed.find({ room: { $in: roomIds }, isActive: true })
      .sort({ bedNumber: 1 })
      .lean();

    const bedIds = allBeds.map((b) => b._id);
    const activeAssignments = await TenantAssignment.find({
      bed: { $in: bedIds },
      isActive: true,
    })
      .populate('tenant', 'fullName email phone status')
      .lean();

    const assignmentByBed = Object.fromEntries(
      activeAssignments.map((a) => [a.bed.toString(), a])
    );

    const bedsByRoom = {};
    for (const bed of allBeds) {
      const key = bed.room.toString();
      if (!bedsByRoom[key]) bedsByRoom[key] = [];
      const assignment = assignmentByBed[bed._id.toString()];
      bedsByRoom[key].push({
        ...bed,
        currentTenant: assignment?.tenant || null,
        assignmentId: assignment?._id || null,
      });
    }

    const data = rooms.map((room) => {
      const beds = bedsByRoom[room._id.toString()] || [];
      return {
        ...room,
        beds,
        bedStats: {
          total: beds.length,
          occupied: beds.filter((b) => b.status === 'occupied').length,
          available: beds.filter((b) => b.status === 'available').length,
          reserved: beds.filter((b) => b.status === 'reserved').length,
          maintenance: beds.filter((b) => b.status === 'maintenance').length,
        },
      };
    });

    res.json({ success: true, data });
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const {
      propertyId,
      floorId,
      roomNumber,
      roomType,
      capacity,
      rentType,
      rentAmount,
      description,
      amenities,
      bedLabels,
    } = req.body;

    if (!propertyId || !floorId || !roomNumber || capacity == null || rentAmount == null) {
      throw new AppError('Missing required room fields', 400);
    }
    const bedCount = Number(capacity);
    if (!Number.isInteger(bedCount) || bedCount < 1) {
      throw new AppError('Each room must have at least 1 bed', 400);
    }
    assertPropertyAccess(req, propertyId);

    const floor = await Floor.findOne({
      _id: floorId,
      property: propertyId,
      organization: req.auth.organizationId,
    });
    if (!floor) throw new AppError('Floor not found for property', 404);

    const room = await Room.create({
      organization: req.auth.organizationId,
      property: propertyId,
      floor: floorId,
      roomNumber,
      roomType: roomType || (bedCount === 1 ? 'single' : bedCount === 2 ? 'double' : 'triple'),
      capacity: bedCount,
      rentType: rentType || 'per_bed',
      rentAmount,
      description,
      amenities: amenities || [],
    });

    const beds = [];
    for (let i = 1; i <= bedCount; i++) {
      const label = bedLabels?.[i - 1] || `Bed ${i}`;
      beds.push({
        organization: req.auth.organizationId,
        property: propertyId,
        floor: floorId,
        room: room._id,
        bedNumber: String(i),
        label,
        status: 'available',
        rentAmount: rentType === 'per_room' ? rentAmount / bedCount : rentAmount,
      });
    }
    await Bed.insertMany(beds);

    const createdBeds = await Bed.find({ room: room._id }).sort({ bedNumber: 1 });
    res.status(201).json({ success: true, data: { ...room.toObject(), beds: createdBeds } });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const room = await Room.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    })
      .populate('floor', 'name level')
      .populate('property', 'name address');
    if (!room) throw new AppError('Room not found', 404);
    assertPropertyAccess(req, room.property._id || room.property);

    const beds = await Bed.find({ room: room._id, isActive: true }).sort({ bedNumber: 1 });
    const history = await TenantAssignment.find({ room: room._id })
      .sort({ moveInDate: -1 })
      .limit(20)
      .populate('tenant', 'fullName email phone')
      .populate('bed', 'bedNumber label');

    res.json({ success: true, data: { ...room.toObject(), beds, history } });
  })
);

router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const room = await Room.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!room) throw new AppError('Room not found', 404);
    assertPropertyAccess(req, room.property);

    [
      'roomNumber',
      'roomType',
      'rentType',
      'rentAmount',
      'description',
      'amenities',
      'images',
      'isActive',
    ].forEach((f) => {
      if (req.body[f] !== undefined) room[f] = req.body[f];
    });
    await room.save();
    res.json({ success: true, data: room });
  })
);

router.patch(
  '/beds/:bedId/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const allowed = ['available', 'occupied', 'reserved', 'maintenance'];
    if (!allowed.includes(status)) throw new AppError('Invalid bed status', 400);

    const bed = await Bed.findOne({
      _id: req.params.bedId,
      organization: req.auth.organizationId,
    });
    if (!bed) throw new AppError('Bed not found', 404);
    assertPropertyAccess(req, bed.property);

    if (status === 'available' || status === 'reserved' || status === 'maintenance') {
      const active = await TenantAssignment.findOne({ bed: bed._id, isActive: true });
      if (active && status !== 'occupied') {
        throw new AppError(
          'Cannot change status while an active tenant is assigned. Check out or transfer first.',
          409
        );
      }
    }

    bed.status = status;
    if (req.body.notes !== undefined) bed.notes = req.body.notes;
    await bed.save();
    res.json({ success: true, data: bed });
  })
);

router.post(
  '/:id/beds',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const room = await Room.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!room) throw new AppError('Room not found', 404);
    assertPropertyAccess(req, room.property);

    // Free numbers held by old soft-deleted beds (legacy unique index / prior deletes).
    const stale = await Bed.find({
      room: room._id,
      isActive: false,
      bedNumber: { $not: /__rm__/ },
    });
    for (const b of stale) {
      const original = b.bedNumber;
      b.bedNumber = `${original}__rm__${b._id}`;
      if (!b.label) b.label = `Bed ${original}`;
      await b.save();
    }

    // Remaining bed numbers stay fixed. New bed takes the lowest free number
    // (so delete Bed 3 → add again → Bed 3, not a duplicate error).
    const existing = await Bed.find({ room: room._id, isActive: true })
      .select('bedNumber')
      .lean();
    const used = new Set(
      existing
        .map((b) => parseInt(String(b.bedNumber), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    let next = 1;
    while (used.has(next)) next += 1;
    const nextNumber = String(next);

    const bed = await Bed.create({
      organization: req.auth.organizationId,
      property: room.property,
      floor: room.floor,
      room: room._id,
      bedNumber: nextNumber,
      label: req.body.label || `Bed ${nextNumber}`,
      rentAmount: req.body.rentAmount ?? room.rentAmount,
      status: 'available',
      isActive: true,
    });

    room.capacity = existing.length + 1;
    await room.save();

    res.status(201).json({
      success: true,
      data: bed,
      message: `Bed ${nextNumber} added. Existing bed numbers were not changed.`,
    });
  })
);

router.delete(
  '/beds/:bedId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const bed = await Bed.findOne({
      _id: req.params.bedId,
      organization: req.auth.organizationId,
      isActive: true,
    })
      .select('_id bedNumber label status room property notes')
      .lean();
    if (!bed) throw new AppError('Bed not found', 404);
    assertPropertyAccess(req, bed.property);

    const [activeAssignment, activeBedsInRoom] = await Promise.all([
      TenantAssignment.findOne({ bed: bed._id, isActive: true }).select('_id').lean(),
      Bed.countDocuments({ room: bed.room, isActive: true }),
    ]);

    if (activeAssignment || bed.status === 'occupied') {
      throw new AppError(
        'Cannot remove an occupied bed. Check out or transfer the tenant first.',
        409
      );
    }
    if (activeBedsInRoom <= 1) {
      throw new AppError(
        'Each room must keep at least 1 bed. Add another bed before removing this one.',
        400
      );
    }

    const originalNumber = bed.bedNumber;
    const removedAt = Date.now();

    // Soft-remove in one write
    await Bed.updateOne(
      { _id: bed._id },
      {
        $set: {
          isActive: false,
          status: 'available',
          label: bed.label || `Bed ${originalNumber}`,
          bedNumber: `${originalNumber}__rm__${removedAt}`,
          notes: [bed.notes, `Removed bed ${originalNumber} by admin on ${new Date(removedAt).toISOString()}`]
            .filter(Boolean)
            .join(' | '),
        },
      }
    );

    const remaining = await Bed.find({ room: bed.room, isActive: true })
      .select('_id bedNumber label')
      .lean();
    remaining.sort((a, b) => {
      const na = parseInt(String(a.bedNumber), 10);
      const nb = parseInt(String(b.bedNumber), 10);
      const aOk = Number.isFinite(na);
      const bOk = Number.isFinite(nb);
      if (aOk && bOk) return na - nb;
      if (aOk) return -1;
      if (bOk) return 1;
      return String(a.bedNumber).localeCompare(String(b.bedNumber));
    });

    // Bulk two-pass renumber (much faster than N sequential saves)
    if (remaining.length) {
      await Bed.bulkWrite(
        remaining.map((b) => ({
          updateOne: {
            filter: { _id: b._id },
            update: { $set: { bedNumber: `__renum__${b._id}` } },
          },
        })),
        { ordered: true }
      );

      await Bed.bulkWrite(
        remaining.map((b, i) => {
          const num = String(i + 1);
          const nextLabel =
            !b.label || /^Bed\s+\d+$/i.test(String(b.label)) ? `Bed ${num}` : b.label;
          return {
            updateOne: {
              filter: { _id: b._id },
              update: { $set: { bedNumber: num, label: nextLabel } },
            },
          };
        }),
        { ordered: true }
      );
    }

    const [rawBeds] = await Promise.all([
      Bed.find({ room: bed.room, isActive: true }).lean(),
      Room.updateOne(
        { _id: bed.room },
        { $set: { capacity: Math.max(1, remaining.length) } }
      ),
    ]);

    rawBeds.sort(
      (a, b) =>
        (parseInt(String(a.bedNumber), 10) || 0) - (parseInt(String(b.bedNumber), 10) || 0)
    );

    const assignments = await TenantAssignment.find({
      bed: { $in: rawBeds.map((b) => b._id) },
      isActive: true,
    })
      .populate('tenant', 'fullName email phone status')
      .lean();
    const byBed = Object.fromEntries(assignments.map((a) => [a.bed.toString(), a]));

    const beds = rawBeds.map((b) => {
      const assignment = byBed[b._id.toString()];
      return {
        ...b,
        currentTenant: assignment?.tenant || null,
        assignmentId: assignment?._id || null,
      };
    });

    res.json({
      success: true,
      message: `Bed ${originalNumber} removed`,
      data: {
        bedId: bed._id,
        bedNumber: originalNumber,
        roomId: String(bed.room),
        remaining: remaining.length,
        beds,
      },
    });
  })
);

module.exports = router;
