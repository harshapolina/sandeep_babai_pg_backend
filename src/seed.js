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
  console.log('Clearing existing demo data...');

  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    await collection.deleteMany({});
  }

  const org = await Organization.create({
    name: 'Has Tracker',
    legalName: 'Has Tracker',
    email: 'ops@pgplatform.local',
    phone: '+91 98765 43210',
    address: 'Banjara Hills, Hyderabad',
    city: 'Hyderabad',
    settings: {
      defaultRentDueDay: 5,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      autoApproveRegistrations: false,
    },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@pgplatform.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  const admin = await User.create({
    organization: org._id,
    email: adminEmail,
    passwordHash: await User.hashPassword(adminPassword),
    fullName: 'Platform Admin',
    phone: '+91 90000 00001',
    role: 'org_admin',
  });

  const staff = await User.create({
    organization: org._id,
    email: 'maintenance@pgplatform.local',
    passwordHash: await User.hashPassword('Staff@12345'),
    fullName: 'Ravi Maintenance',
    phone: '+91 90000 00002',
    role: 'maintenance_staff',
  });

  const propertyDefs = [
    {
      name: 'PG A — Banjara Hills',
      code: 'PGA',
      address: 'Road No. 12, Banjara Hills, Hyderabad',
      defaultRentAmount: 9500,
      facilities: ['WiFi', 'Laundry', 'CCTV', 'Power Backup', 'Meals'],
    },
    {
      name: 'PG B — Madhapur',
      code: 'PGB',
      address: 'Near Cyber Towers, Madhapur, Hyderabad',
      defaultRentAmount: 11000,
      facilities: ['WiFi', 'Gym', 'CCTV', 'RO Water'],
    },
    {
      name: 'PG C — Gachibowli',
      code: 'PGC',
      address: 'Financial District Road, Gachibowli, Hyderabad',
      defaultRentAmount: 10500,
      facilities: ['WiFi', 'Meals', 'Housekeeping', 'Parking'],
    },
    {
      name: 'PG D — Kukatpally',
      code: 'PGD',
      address: 'KPHB Phase 1, Kukatpally, Hyderabad',
      defaultRentAmount: 8000,
      facilities: ['WiFi', 'CCTV', 'Water Supply'],
    },
  ];

  const properties = [];
  for (const def of propertyDefs) {
    const property = await Property.create({
      organization: org._id,
      ...def,
      city: 'Hyderabad',
      state: 'Telangana',
      contactPhone: '+91 98765 43210',
      contactEmail: 'care@pgplatform.local',
      description: `${def.name} — comfortable paying guest accommodation.`,
      defaultDepositAmount: def.defaultRentAmount * 2,
      houseRules:
        'Quiet hours 10 PM – 6 AM. Guests must register at reception. Keep common areas clean.',
    });
    properties.push(property);

    for (let level = 0; level <= 2; level++) {
      const floor = await Floor.create({
        organization: org._id,
        property: property._id,
        name: level === 0 ? 'Ground Floor' : `Floor ${level}`,
        level,
      });

      for (let r = 1; r <= 3; r++) {
        const roomNumber = `${level}${String(r).padStart(2, '0')}`;
        const capacity = r === 1 ? 1 : r === 2 ? 2 : 3;
        const room = await Room.create({
          organization: org._id,
          property: property._id,
          floor: floor._id,
          roomNumber,
          roomType: capacity === 1 ? 'single' : capacity === 2 ? 'double' : 'triple',
          capacity,
          rentType: 'per_bed',
          rentAmount: def.defaultRentAmount,
          amenities: ['Fan', 'Wardrobe', 'Study Table', 'Attached Bath'].slice(
            0,
            capacity + 1
          ),
          description: `${capacity}-sharing room on ${floor.name}`,
        });

        for (let b = 1; b <= capacity; b++) {
          await Bed.create({
            organization: org._id,
            property: property._id,
            floor: floor._id,
            room: room._id,
            bedNumber: String(b),
            label: `Bed ${b}`,
            status: 'available',
            rentAmount: def.defaultRentAmount,
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

  const tenantEmail = process.env.SEED_TENANT_EMAIL || 'tenant@pgplatform.local';
  const tenantPassword = process.env.SEED_TENANT_PASSWORD || 'Tenant@12345';
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
    emergencyContact: { name: 'Suresh Reddy', phone: '+91 98888 22222', relation: 'Father' },
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
    property: pgA._id,
    label: 'PG A open registration',
    createdBy: admin._id,
    expiresAt: new Date(Date.now() + 30 * 86400000),
  });

  await Announcement.create({
    organization: org._id,
    title: 'Welcome to Has Tracker',
    body: 'Please keep your ID documents updated and pay rent by the 5th of each month.',
    category: 'general',
    scope: 'all',
    createdBy: admin._id,
  });

  console.log('\nSeed complete.\n');
  console.log('Admin login:', adminEmail, '/', adminPassword);
  console.log('Tenant login:', tenantEmail, '/', tenantPassword);
  console.log('Staff login: maintenance@pgplatform.local / Staff@12345');
  console.log('Registration link token:', link.token);
  console.log(`Public URL: ${process.env.CLIENT_URL}/register/${link.token}`);
  console.log('Properties:', properties.map((p) => p.name).join(' | '));

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
