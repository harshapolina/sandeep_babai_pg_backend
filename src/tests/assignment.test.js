const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const {
  Organization,
  User,
  Property,
  Floor,
  Room,
  Bed,
  Tenant,
  TenantAssignment,
} = require('../models');
const { assignTenantToBed } = require('../services/assignmentService');

describe('Bed assignment concurrency', () => {
  let org;
  let bed;
  let tenants = [];

  before(async () => {
    await connectDB();
    org = await Organization.create({ name: 'Test Org' });
    const property = await Property.create({
      organization: org._id,
      name: 'Test PG',
      address: 'Test Address',
    });
    const floor = await Floor.create({
      organization: org._id,
      property: property._id,
      name: 'G',
      level: 0,
    });
    const room = await Room.create({
      organization: org._id,
      property: property._id,
      floor: floor._id,
      roomNumber: 'T01',
      capacity: 1,
      rentAmount: 5000,
    });
    bed = await Bed.create({
      organization: org._id,
      property: property._id,
      floor: floor._id,
      room: room._id,
      bedNumber: '1',
      status: 'available',
    });

    for (let i = 0; i < 2; i++) {
      const user = await User.create({
        organization: org._id,
        email: `concurrent${i}_${Date.now()}@test.local`,
        passwordHash: await User.hashPassword('Test@12345'),
        fullName: `Tenant ${i}`,
        role: 'tenant',
      });
      const tenant = await Tenant.create({
        organization: org._id,
        user: user._id,
        fullName: `Tenant ${i}`,
        email: user.email,
        phone: '9999999999',
        status: 'pending',
        registrationStatus: 'approved',
      });
      tenants.push(tenant);
    }
  });

  after(async () => {
    if (org) {
      await TenantAssignment.deleteMany({ organization: org._id });
      await Tenant.deleteMany({ organization: org._id });
      await User.deleteMany({ organization: org._id });
      await Bed.deleteMany({ organization: org._id });
      await Room.deleteMany({ organization: org._id });
      await Floor.deleteMany({ organization: org._id });
      await Property.deleteMany({ organization: org._id });
      await Organization.deleteMany({ _id: org._id });
    }
    await mongoose.disconnect();
  });

  it('allows only one active assignment per bed under concurrent requests', async () => {
    const results = await Promise.allSettled([
      assignTenantToBed({
        organizationId: org._id,
        tenantId: tenants[0]._id,
        bedId: bed._id,
        moveInDate: new Date(),
        rentAmount: 5000,
      }),
      assignTenantToBed({
        organizationId: org._id,
        tenantId: tenants[1]._id,
        bedId: bed._id,
        moveInDate: new Date(),
        rentAmount: 5000,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const activeCount = await TenantAssignment.countDocuments({
      bed: bed._id,
      isActive: true,
    });
    assert.equal(activeCount, 1);
  });
});
