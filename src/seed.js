require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');
const { Organization, User, RegistrationLink } = require('./models');

/**
 * Fresh start: wipe DB and create only org + admin + master registration form.
 * No demo properties / tenants ? you build everything from the admin portal.
 */
async function seed() {
  await connectDB();
  console.log('Wiping all data for a fresh start...');

  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    await collection.deleteMany({});
  }

  const org = await Organization.create({
    name: 'Has Tracker',
    legalName: 'Has Tracker',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@hastracker.com',
    phone: '',
    address: '',
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
    phone: process.env.SEED_ADMIN_PHONE || '',
    role: 'org_admin',
  });

  const link = await RegistrationLink.create({
    organization: org._id,
    isMaster: true,
    label: 'Master registration form',
    createdBy: admin._id,
    formConfig: {
      brandName: 'Has Tracker',
      title: 'Apply for a bed',
      subtitle: 'Pick a property and tell us about you.',
      ctaLabel: 'Submit application',
      successTitle: "You're in",
      successMessage:
        'Your account is ready. Admin will assign your room and bed next.',
    },
  });

  console.log('\nFresh start complete.\n');
  console.log('????????????????????????????????????');
  console.log('Admin email:   ', adminEmail);
  console.log('Admin password:', adminPassword);
  console.log('????????????????????????????????????');
  console.log('Registration token:', link.token);
  console.log(
    `Public form: ${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')}/register/${link.token}`
  );
  console.log('\nNext: log in as admin ? add Properties ? Rooms ? share registration link.');

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
