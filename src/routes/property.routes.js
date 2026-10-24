const express = require('express');
const {
  Property,
  Floor,
  Room,
  Bed,
  Tenant,
  Payment,
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
const { writeAudit } = require('../services/auditService');

const router = express.Router();
router.use(authenticate, requireStaff);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = { organization: req.auth.organizationId };
    const allowed = getAccessiblePropertyIds(req);
    if (allowed) query._id = { $in: allowed };
    if (req.query.active === 'true') query.isActive = true;
    if (req.query.active === 'false') query.isActive = false;
    if (req.query.q) {
      query.$or = [
        { name: new RegExp(req.query.q, 'i') },
        { address: new RegExp(req.query.q, 'i') },
      ];
    }

    const properties = await Property.find(query).sort({ name: 1 }).lean();
    if (!properties.length) {
      return res.json({ success: true, data: [] });
    }

    const ids = properties.map((p) => p._id);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [floorAgg, roomAgg, bedAgg, tenantAgg, revenueAgg] = await Promise.all([
      Floor.aggregate([
        { $match: { property: { $in: ids }, isActive: true } },
        { $group: { _id: '$property', count: { $sum: 1 } } },
      ]),
      Room.aggregate([
        { $match: { property: { $in: ids }, isActive: true } },
        { $group: { _id: '$property', count: { $sum: 1 } } },
      ]),
      Bed.aggregate([
        { $match: { property: { $in: ids }, isActive: true } },
        {
          $group: {
            _id: '$property',
            beds: { $sum: 1 },
            occupied: {
              $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] },
            },
          },
        },
      ]),
      Tenant.aggregate([
        { $match: { property: { $in: ids }, status: 'active' } },
        { $group: { _id: '$property', count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        {
          $match: {
            property: { $in: ids },
            type: 'rent',
            paidAt: { $gte: monthStart },
          },
        },
        { $group: { _id: '$property', total: { $sum: '$amount' } } },
      ]),
    ]);

    const toMap = (rows, field = 'count') =>
      Object.fromEntries(rows.map((r) => [r._id.toString(), r[field] ?? r]));

    const floors = toMap(floorAgg);
    const rooms = toMap(roomAgg);
    const tenants = toMap(tenantAgg);
    const revenue = toMap(revenueAgg, 'total');
    const bedsByProp = Object.fromEntries(
      bedAgg.map((r) => [r._id.toString(), r])
    );

    const enriched = properties.map((p) => {
      const key = p._id.toString();
      const bedRow = bedsByProp[key] || { beds: 0, occupied: 0 };
      const bedCount = bedRow.beds || 0;
      const occupied = bedRow.occupied || 0;
      return {
        ...p,
        stats: {
          floors: floors[key] || 0,
          rooms: rooms[key] || 0,
          beds: bedCount,
          occupied,
          available: bedCount - occupied,
          tenants: tenants[key] || 0,
          occupancyPct: bedCount ? Math.round((occupied / bedCount) * 100) : 0,
          monthlyRevenue: revenue[key] || 0,
        },
      };
    });

    res.json({ success: true, data: enriched });
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      address,
      city,
      state,
      pincode,
      contactPhone,
      contactEmail,
      description,
      facilities,
      defaultRentAmount,
      defaultDepositAmount,
      houseRules,
      code,
    } = req.body;

    if (!name || !address) throw new AppError('Name and address are required', 400);

    const property = await Property.create({
      organization: req.auth.organizationId,
      name,
      code,
      address,
      city,
      state,
      pincode,
      contactPhone,
      contactEmail,
      description,
      facilities: facilities || [],
      defaultRentAmount: defaultRentAmount || 0,
      defaultDepositAmount: defaultDepositAmount || 0,
      houseRules,
    });

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'property.create',
      entityType: 'Property',
      entityId: property._id,
      after: property.toObject(),
      req,
    });

    res.status(201).json({ success: true, data: property });
  })
);

/**
 * Full customized property setup:
 * property + floors + rooms + beds (min 1 bed per room) in one request.
 * Body.structure = [{ name, level, rooms: [{ roomNumber, bedCount, rentAmount, roomType, amenities }] }]
 */
router.post(
  '/setup',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      address,
      city,
      state,
      pincode,
      contactPhone,
      contactEmail,
      description,
      facilities,
      defaultRentAmount,
      defaultDepositAmount,
      houseRules,
      code,
      structure,
    } = req.body;

    if (!name || !address) throw new AppError('Name and address are required', 400);
    if (!Array.isArray(structure) || !structure.length) {
      throw new AppError('Add at least one floor with rooms and beds', 400);
    }

    const orgId = req.auth.organizationId;
    const rentDefault = Number(defaultRentAmount) || 0;

    for (const floor of structure) {
      if (!floor.name || floor.level == null) {
        throw new AppError('Each floor needs a name and level', 400);
      }
      if (!Array.isArray(floor.rooms) || !floor.rooms.length) {
        throw new AppError(`Floor "${floor.name}" must have at least one room`, 400);
      }
      for (const room of floor.rooms) {
        if (!room.roomNumber) {
          throw new AppError(`Room number is required on ${floor.name}`, 400);
        }
        const bedCount = Number(room.bedCount);
        if (!Number.isInteger(bedCount) || bedCount < 1) {
          throw new AppError(
            `Room ${room.roomNumber} must have at least 1 bed`,
            400
          );
        }
      }
    }

    const property = await Property.create({
      organization: orgId,
      name,
      code,
      address,
      city,
      state,
      pincode,
      contactPhone,
      contactEmail,
      description,
      facilities: facilities || [],
      defaultRentAmount: rentDefault,
      defaultDepositAmount: Number(defaultDepositAmount) || 0,
      houseRules,
    });

    let totalFloors = 0;
    let totalRooms = 0;
    let totalBeds = 0;
    const createdFloors = [];

    for (const floorDef of structure) {
      const floor = await Floor.create({
        organization: orgId,
        property: property._id,
        name: floorDef.name,
        level: Number(floorDef.level),
        description: floorDef.description,
      });
      totalFloors += 1;
      const floorRooms = [];

      for (const roomDef of floorDef.rooms) {
        const bedCount = Number(roomDef.bedCount);
        const rentAmount = Number(roomDef.rentAmount ?? rentDefault);
        const roomType =
          roomDef.roomType ||
          (bedCount === 1
            ? 'single'
            : bedCount === 2
              ? 'double'
              : bedCount === 3
                ? 'triple'
                : bedCount === 4
                  ? 'quad'
                  : 'other');

        const room = await Room.create({
          organization: orgId,
          property: property._id,
          floor: floor._id,
          roomNumber: String(roomDef.roomNumber).trim(),
          roomType,
          capacity: bedCount,
          rentType: roomDef.rentType || 'per_bed',
          rentAmount,
          description: roomDef.description,
          amenities: roomDef.amenities || [],
        });
        totalRooms += 1;

        const beds = [];
        for (let i = 1; i <= bedCount; i++) {
          beds.push({
            organization: orgId,
            property: property._id,
            floor: floor._id,
            room: room._id,
            bedNumber: String(i),
            label: roomDef.bedLabels?.[i - 1] || `Bed ${i}`,
            status: 'available',
            rentAmount:
              room.rentType === 'per_room' ? rentAmount / bedCount : rentAmount,
          });
        }
        await Bed.insertMany(beds);
        totalBeds += bedCount;
        floorRooms.push({
          ...room.toObject(),
          bedCount,
        });
      }

      createdFloors.push({
        ...floor.toObject(),
        rooms: floorRooms,
      });
    }

    await writeAudit({
      organization: orgId,
      actor: req.user._id,
      action: 'property.setup',
      entityType: 'Property',
      entityId: property._id,
      after: { floors: totalFloors, rooms: totalRooms, beds: totalBeds },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        property,
        floors: createdFloors,
        summary: { floors: totalFloors, rooms: totalRooms, beds: totalBeds },
      },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    assertPropertyAccess(req, req.params.id);
    const property = await Property.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!property) throw new AppError('Property not found', 404);

    const floors = await Floor.find({ property: property._id }).sort({ level: 1 });
    res.json({ success: true, data: { ...property.toObject(), floors } });
  })
);

router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const property = await Property.findOne({
      _id: req.params.id,
      organization: req.auth.organizationId,
    });
    if (!property) throw new AppError('Property not found', 404);

    const before = property.toObject();
    const fields = [
      'name',
      'code',
      'address',
      'city',
      'state',
      'pincode',
      'contactPhone',
      'contactEmail',
      'description',
      'facilities',
      'defaultRentAmount',
      'defaultDepositAmount',
      'houseRules',
      'isActive',
      'images',
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) property[f] = req.body[f];
    });
    await property.save();

    await writeAudit({
      organization: req.auth.organizationId,
      actor: req.user._id,
      action: 'property.update',
      entityType: 'Property',
      entityId: property._id,
      before,
      after: property.toObject(),
      req,
    });

    res.json({ success: true, data: property });
  })
);

router.post(
  '/:id/floors',
  requireAdmin,
  asyncHandler(async (req, res) => {
    assertPropertyAccess(req, req.params.id);
    const { name, level, description } = req.body;
    if (level == null || !name) throw new AppError('Name and level required', 400);

    const floor = await Floor.create({
      organization: req.auth.organizationId,
      property: req.params.id,
      name,
      level,
      description,
    });

    res.status(201).json({ success: true, data: floor });
  })
);

router.get(
  '/:id/floors',
  asyncHandler(async (req, res) => {
    assertPropertyAccess(req, req.params.id);
    const floors = await Floor.find({
      property: req.params.id,
      organization: req.auth.organizationId,
    }).sort({ level: 1 });
    res.json({ success: true, data: floors });
  })
);

module.exports = router;
