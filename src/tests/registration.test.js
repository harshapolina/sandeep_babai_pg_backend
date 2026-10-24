const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const {
  Organization,
  Property,
  RegistrationLink,
  RegistrationSubmission,
} = require('../models');
const { DEFAULT_FORM_CONFIG } = require('../models/RegistrationLink');

describe('Registration links & form config', () => {
  let org;
  let property;
  let link;

  before(async () => {
    await connectDB();
    org = await Organization.create({ name: `Reg Org ${Date.now()}` });
    property = await Property.create({
      organization: org._id,
      name: 'Reg Test PG',
      address: 'Hyderabad',
      defaultRentAmount: 9000,
    });
    link = await RegistrationLink.create({
      organization: org._id,
      property: property._id,
      label: 'Open intake',
      formConfig: {
        ...DEFAULT_FORM_CONFIG,
        title: 'Join Reg Test PG',
        showGender: false,
        showNotes: true,
      },
      expiresAt: new Date(Date.now() + 7 * 86400000),
      isActive: true,
    });
  });

  after(async () => {
    if (org) {
      await RegistrationSubmission.deleteMany({ organization: org._id });
      await RegistrationLink.deleteMany({ organization: org._id });
      await Property.deleteMany({ organization: org._id });
      await Organization.deleteMany({ _id: org._id });
    }
    await mongoose.disconnect();
  });

  it('stores editable formConfig on the link', async () => {
    const found = await RegistrationLink.findById(link._id).lean();
    assert.equal(found.formConfig.title, 'Join Reg Test PG');
    assert.equal(found.formConfig.showGender, false);
    assert.equal(found.formConfig.showNotes, true);
    assert.ok(found.token);
  });

  it('isValidForUse is true for active unexpired links', () => {
    assert.equal(link.isValidForUse(), true);
  });

  it('rejects invalid/expired links via isValidForUse', async () => {
    link.isActive = false;
    await link.save();
    assert.equal(link.isValidForUse(), false);
    link.isActive = true;
    link.expiresAt = new Date(Date.now() - 1000);
    await link.save();
    assert.equal(link.isValidForUse(), false);
    link.expiresAt = new Date(Date.now() + 86400000);
    await link.save();
    assert.equal(link.isValidForUse(), true);
  });

  it('accepts a pending submission with optional fields', async () => {
    const submission = await RegistrationSubmission.create({
      organization: org._id,
      registrationLink: link._id,
      property: property._id,
      fullName: 'Test Applicant',
      email: `applicant_${Date.now()}@test.local`,
      phone: '9876543210',
      gender: 'female',
      occupation: 'Student',
      emergencyContact: { name: 'Parent', phone: '9123456780', relation: 'Mother' },
      preferredRoomType: 'double',
      status: 'pending',
    });
    assert.equal(submission.status, 'pending');
    assert.equal(submission.occupation, 'Student');

    link.useCount += 1;
    await link.save();
    const refreshed = await RegistrationLink.findById(link._id);
    assert.equal(refreshed.useCount, 1);
  });

  it('updates formConfig fields independently', async () => {
    link.formConfig.title = 'Updated headline';
    link.formConfig.showEmergencyContact = false;
    await link.save();
    const found = await RegistrationLink.findById(link._id).lean();
    assert.equal(found.formConfig.title, 'Updated headline');
    assert.equal(found.formConfig.showEmergencyContact, false);
    assert.equal(found.formConfig.showNotes, true);
  });
});
