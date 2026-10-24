require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');
const {
  Organization,
  User,
  Property,
  Floor,
  Room,
  Bed,
  Tenant,
  RegistrationLink,
  RentRecord,
  Announcement,
  StaffAssignment,
} = require('./models');

async function seed() {
  await connectDB();
  console.log('Wiping database and seeding demo data...');

  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    await collection.deleteMany({});
  }

  const org = await Organization.create({
    name: 'Has Tracker',
    legalName: 'Has Tracker',
    email: 'ops@hastracker.com',
    phone: '+91 98765 43210',
    address: 'Banjara Hills, Hyderabad',
    city: 'Hyderabad',
    state: 'Telangana',
    settings: {
      appName: 'Has Tracker',
      defaultRentDueDay: 5,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      autoApproveRegistrations: true,
      ticketCategories: [
        'Plumbing',
        'Electrical',
        'Cleaning',
        'Furniture',
        'Internet',
        'Water supply',
        'Other',
      ],
      chatbot: { enabled: true, provider: 'auto' },
    },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@hastracker.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'HasTracker@2026';
  const admin = await User.create({
    organization: org._id,
    email: adminEmail,
    passwordHash: await User.hashPassword(adminPassword),
    fullName: process.env.SEED_ADMIN_NAME || 'Has Tracker Admin',
    phone: '+91 90000 00001',
    role: 'org_admin',
  });

  const staff = await User.create({
    organization: org._id,
    email: process.env.SEED_STAFF_EMAIL || 'staff@hastracker.com',
    passwordHash: await User.hashPassword(
      process.env.SEED_STAFF_PASSWORD || 'Staff@2026'
    ),
    fullName: 'Ravi Maintenance',
    phone: '+91 90000 00002',
    role: 'maintenance_staff',
  });

  const propertyDefs = [
    {
      name: 'PG A ? Banjara Hills',
      code: 'PGA',
      address: 'Road No. 12, Banjara Hills, Hyderabad',
      defaultRentAmount: 9500,
      defaultDepositAmount: 9500,
      facilities: ['WiFi', 'Laundry', 'CCTV', 'Power Backup', 'Meals'],
    },
    {
      name: 'PG B ? Madhapur',
      code: 'PGB',
      address: 'Near Cyber Towers, Madhapur, Hyderabad',
      defaultRentAmount: 11000,
      defaultDepositAmount: 11000,
      facilities: ['WiFi', 'Gym', 'CCTV', 'RO Water'],
    },
    {
      name: 'PG C ? Gachibowli',
      code: 'PGC',
      address: 'Financial District Road, Gachibowli, Hyderabad',
      defaultRentAmount: 12000,
      defaultDepositAmount: 12000,
      facilities: ['WiFi', 'Laundry', 'CCTV', 'Housekeeping'],
    },
  ];

  const properties = [];
  for (const def of propertyDefs) {
    const property = await Property.create({
      organization: org._id,
      ...def,
      city: 'Hyderabad',
      state: 'Telangana',
      isActive: true,
    });
    properties.push(property);

    for (let level = 0; level <= 2; level++) {
      const floor = await Floor.create({
        organization: org._id,
        property: property._id,
        name: level === 0 ? 'Ground' : `Floor ${level}`,
        level,
      });

      for (let r = 1; r <= 3; r++) {
        const room = await Room.create({
          organization: org._id,
          property: property._id,
          floor: floor._id,
          roomNumber: `${level}${String(r).padStart(2, '0')}`,
          roomType: 'triple',
          capacity: 3,
          rentType: 'per_bed',
          rentAmount: def.defaultRentAmount,
          amenities: ['Fan', 'Cupboard'],
          isActive: true,
        });

        for (let b = 1; b <= 3; b++) {
          await Bed.create({
            organization: org._id,
            property: property._id,
            floor: floor._id,
            room: room._id,
            bedNumber: String(b),
            status: 'available',
            rentAmount: def.defaultRentAmount,
            isActive: true,
          });
        }
      }
    }
  }

  await StaffAssignment.create({
    organization: org._id,
    user: staff._id,
    properties: properties.map((p) => p._id),
    role: 'maintenance_staff',
    permissions: {
      manageTickets: true,
      viewReports: false,
    },
  });

  const tenantEmail = process.env.SEED_TENANT_EMAIL || 'tenant@hastracker.com';
  const tenantPassword = process.env.SEED_TENANT_PASSWORD || 'Tenant@2026';
  const tenantUser = await User.create({
    organization: org._id,
    email: tenantEmail,
    passwordHash: await User.hashPassword(tenantPassword),
    fullName: 'Ananya Reddy',
    phone: '+91 98888 11111',
    role: 'tenant',
  });

  const pgA = properties[0];
  const bed = await Bed.findOne({ property: pgA._id, status: 'available' }).sort({
    createdAt: 1,
  });

  const tenant = await Tenant.create({
    organization: org._id,
    user: tenantUser._id,
    property: pgA._id,
    fullName: 'Ananya Reddy',
    email: tenantEmail,
    phone: '+91 98888 11111',
    emergencyContact: {
      name: 'Suresh Reddy',
      phone: '+91 98888 22222',
      relation: 'Father',
    },
    status: 'active',
    registrationStatus: 'approved',
    agreedRent: pgA.defaultRentAmount,
    securityDeposit: pgA.defaultDepositAmount,
    moveInDate: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
  });

  const { assignTenantToBed } = require('./services/assignmentService');
  await assignTenantToBed({
    organizationId: org._id,
    tenantId: tenant._id,
    bedId: bed._id,
    moveInDate: tenant.moveInDate,
    rentAmount: pgA.defaultRentAmount,
    securityDepositAmount: pgA.defaultDepositAmount,
    createdBy: admin._id,
  });

  const now = new Date();
  await RentRecord.create({
    organization: org._id,
    tenant: tenant._id,
    property: pgA._id,
    periodMonth: now.getMonth() + 1,
    periodYear: now.getFullYear(),
    dueDate: new Date(now.getFullYear(), now.getMonth(), 5),
    amountDue: pgA.defaultRentAmount,
    amountPaid: 0,
    status: 'pending',
  });

  const link = await RegistrationLink.create({
    organization: org._id,
    isMaster: true,
    label: 'Master registration form',
    createdBy: admin._id,
    formConfig: {
      brandName: 'Has Tracker',
      title: 'Apply for a bed',
      subtitle: 'One application for all our homes. Pick a property and tell us about you.',
      ctaLabel: 'Submit application',
      successTitle: "You're in",
      successMessage:
        'Your account is ready. Admin will assign your room and bed next.',
    },
  });

  await Announcement.create({
    organization: org._id,
    title: 'Welcome to Has Tracker',
    body: 'Please keep your ID documents updated and pay rent by the 5th of each month.',
    category: 'general',
    scope: 'all',
    createdBy: admin._id,
  });

  console.log('\nDemo seed complete.\n');
  console.log('????????????????????????????????????????');
  console.log('Admin:  ', adminEmail, '/', adminPassword);
  console.log('Tenant: ', tenantEmail, '/', tenantPassword);
  console.log(
    'Staff:  ',
    process.env.SEED_STAFF_EMAIL || 'staff@hastracker.com',
    '/',
    process.env.SEED_STAFF_PASSWORD || 'Staff@2026'
  );
  console.log('????????????????????????????????????????');
  console.log('Properties:', properties.map((p) => p.name).join(' | '));
  console.log('Registration token:', link.token);
  console.log(
    `Public form: ${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')}/register/${link.token}`
  );

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
