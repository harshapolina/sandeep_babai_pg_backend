const jwt = require('jsonwebtoken');
const { User, StaffAssignment, Tenant } = require('../models');
const { AppError } = require('../utils/AppError');
const { asyncHandler } = require('../utils/asyncHandler');

const STAFF_ROLES = [
  'org_admin',
  'property_manager',
  'maintenance_staff',
  'cleaning_staff',
  'accountant',
  'readonly_staff',
];

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;

  if (!token) {
    throw new AppError('Authentication required', 401);
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw new AppError('User not found or inactive', 401);
  }

  req.user = user;
  req.auth = {
    userId: user._id,
    organizationId: user.organization,
    role: user.role,
  };

  if (user.role === 'tenant') {
    const tenant = await Tenant.findOne({ user: user._id });
    req.tenant = tenant;
  } else if (user.role !== 'org_admin') {
    const assignment = await StaffAssignment.findOne({
      user: user._id,
      organization: user.organization,
      isActive: true,
    });
    req.staffAssignment = assignment;
  }

  next();
});

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}

function requireStaff(req, res, next) {
  if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
    return next(new AppError('Staff access required', 403));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'org_admin') {
    return next(new AppError('Admin access required', 403));
  }
  next();
}

function getAccessiblePropertyIds(req) {
  if (req.user.role === 'org_admin') return null; // all
  if (req.staffAssignment?.properties?.length) {
    return req.staffAssignment.properties.map((id) => id.toString());
  }
  return [];
}

function assertPropertyAccess(req, propertyId) {
  if (req.user.role === 'org_admin') return true;
  const allowed = getAccessiblePropertyIds(req);
  if (!allowed || allowed.length === 0) {
    throw new AppError('No property access configured', 403);
  }
  if (!allowed.includes(propertyId.toString())) {
    throw new AppError('You do not have access to this property', 403);
  }
  return true;
}

module.exports = {
  authenticate,
  requireRoles,
  requireStaff,
  requireAdmin,
  getAccessiblePropertyIds,
  assertPropertyAccess,
  STAFF_ROLES,
};
