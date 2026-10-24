const crypto = require('crypto');
const {
  Organization,
  Property,
  Floor,
  Room,
  Bed,
  Tenant,
  TenantAssignment,
  Announcement,
  MaintenanceTicket,
  RentRecord,
  RegistrationLink,
  User,
  KnowledgeChunk,
} = require('../models');
const { buildHelpDocs } = require('./ragHelpDocs');

function fp(parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex');
}

function tokenize(text = '') {
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
    ),
  ].slice(0, 40);
}

function chunkDoc({
  organization,
  sourceType,
  sourceId,
  title,
  content,
  audience = 'all',
  extraKeywords = [],
}) {
  const body = String(content || '').trim();
  if (!body) return null;
  const keywords = [...tokenize(`${title} ${body}`), ...extraKeywords.map((k) => String(k).toLowerCase())];
  return {
    organization,
    sourceType,
    sourceId: String(sourceId || ''),
    title: String(title).trim(),
    content: body.slice(0, 4000),
    audience,
    keywords: [...new Set(keywords)].slice(0, 50),
    fingerprint: fp([organization, sourceType, sourceId, title, body.slice(0, 500)]),
  };
}

async function upsertChunks(orgId, docs) {
  const valid = docs.filter(Boolean);
  const fingerprints = valid.map((d) => d.fingerprint);
  const ops = valid.map((d) => ({
    updateOne: {
      filter: {
        organization: orgId,
        sourceType: d.sourceType,
        sourceId: d.sourceId,
        title: d.title,
      },
      update: { $set: d },
      upsert: true,
    },
  }));
  if (ops.length) await KnowledgeChunk.bulkWrite(ops, { ordered: false });
  return fingerprints;
}

async function indexOrganization(org) {
  const orgId = org._id;
  const appName = org.settings?.appName || org.name || 'Has Tracker';
  const docs = [];
  const keep = [];

  // Help
  for (const h of buildHelpDocs(appName)) {
    const d = chunkDoc({
      organization: orgId,
      sourceType: 'help',
      sourceId: h.sourceId,
      title: h.title,
      content: h.content,
      audience: h.audience,
      extraKeywords: h.keywords,
    });
    docs.push(d);
  }

  // Organization / settings (no SMTP password)
  docs.push(
    chunkDoc({
      organization: orgId,
      sourceType: 'organization',
      sourceId: String(orgId),
      title: `${appName} organization profile`,
      content: [
        `Organization: ${org.name}.`,
        org.email ? `Contact email: ${org.email}.` : '',
        org.phone ? `Phone: ${org.phone}.` : '',
        org.address ? `Address: ${org.address}, ${org.city || ''} ${org.state || ''}.` : '',
        `App name: ${appName}.`,
        `Default rent due day: ${org.settings?.defaultRentDueDay ?? 5}.`,
        `Currency: ${org.settings?.currency || 'INR'}.`,
        `Timezone: ${org.settings?.timezone || 'Asia/Kolkata'}.`,
        `Ticket categories: ${(org.settings?.ticketCategories || []).join(', ')}.`,
        `Email sending: ${org.settings?.mail?.enabled ? 'enabled' : 'disabled'}.`,
        org.settings?.mail?.host ? `SMTP host: ${org.settings.mail.host}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      audience: 'admin',
      extraKeywords: ['organization', 'settings', 'contact', 'rent due'],
    })
  );

  docs.push(
    chunkDoc({
      organization: orgId,
      sourceType: 'payment_policy',
      sourceId: 'policy',
      title: 'Rent and payment policy',
      content: `Rent is generally due by day ${org.settings?.defaultRentDueDay ?? 5} of each month. Currency is ${org.settings?.currency || 'INR'}. Tenants mark payments as paid in the tenant Payments section and can attach a screenshot. Staff review status in Rent & Payments.`,
      audience: 'all',
      extraKeywords: ['rent', 'due', 'policy', 'payment'],
    })
  );

  const properties = await Property.find({ organization: orgId, isActive: true }).lean();
  for (const p of properties) {
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'property',
        sourceId: String(p._id),
        title: `Property: ${p.name}`,
        content: [
          `${p.name}${p.code ? ` (${p.code})` : ''} at ${p.address}, ${p.city}, ${p.state}${p.pincode ? ` ${p.pincode}` : ''}.`,
          p.description || '',
          p.facilities?.length ? `Facilities: ${p.facilities.join(', ')}.` : '',
          p.houseRules ? `House rules: ${p.houseRules}.` : '',
          p.defaultRentAmount ? `Default rent: ${p.defaultRentAmount} ${org.settings?.currency || 'INR'}.` : '',
          p.defaultDepositAmount ? `Default deposit: ${p.defaultDepositAmount}.` : '',
          p.contactPhone ? `Property phone: ${p.contactPhone}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
        audience: 'all',
        extraKeywords: [p.name, p.code, p.city, ...(p.facilities || [])].filter(Boolean),
      })
    );
  }

  const floors = await Floor.find({ organization: orgId }).lean();
  const rooms = await Room.find({ organization: orgId, isActive: { $ne: false } }).lean();
  const beds = await Bed.find({ organization: orgId, isActive: true }).lean();
  const floorMap = Object.fromEntries(floors.map((f) => [String(f._id), f]));
  const propMap = Object.fromEntries(properties.map((p) => [String(p._id), p]));

  for (const room of rooms) {
    const floor = floorMap[String(room.floor)];
    const prop = propMap[String(room.property)];
    const roomBeds = beds.filter((b) => String(b.room) === String(room._id));
    const occupied = roomBeds.filter((b) => b.status === 'occupied').length;
    const label = room.roomNumber || room.name || 'room';
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'room',
        sourceId: String(room._id),
        title: `Room ${label} (${prop?.name || 'property'})`,
        content: `Room ${label} (${room.roomType || 'type n/a'}) on ${floor?.name || 'a floor'} at ${prop?.name || 'property'}. Capacity ${room.capacity || roomBeds.length} beds, ${occupied} occupied, ${roomBeds.length - occupied} free. Bed numbers: ${roomBeds.map((b) => b.bedNumber).join(', ') || 'none'}. Rent: ${room.rentAmount || prop?.defaultRentAmount || 'n/a'} (${room.rentType || 'per_bed'}). ${(room.amenities || []).length ? `Amenities: ${room.amenities.join(', ')}.` : ''}`,
        audience: 'admin',
        extraKeywords: [label, prop?.name, floor?.name, room.roomType].filter(Boolean),
      })
    );
  }

  const assignments = await TenantAssignment.find({
    organization: orgId,
    isActive: true,
  })
    .populate('tenant', 'fullName phone email')
    .populate('property', 'name')
    .populate('room', 'roomNumber')
    .populate('bed', 'bedNumber')
    .lean();

  for (const a of assignments.slice(0, 200)) {
    const t = a.tenant;
    if (!t) continue;
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'tenant',
        sourceId: String(t._id || a.tenant),
        title: `Tenant ${t.fullName || 'resident'}`,
        content: `Tenant ${t.fullName || ''} assigned to ${a.property?.name || 'property'}, room ${a.room?.roomNumber || ''}, bed ${a.bed?.bedNumber ?? ''}. Phone: ${t.phone || 'n/a'}. Email: ${t.email || 'n/a'}. Rent: ${a.rentAmount ?? 'n/a'}. Move-in: ${a.moveInDate ? new Date(a.moveInDate).toLocaleDateString('en-IN') : 'n/a'}.`,
        audience: 'admin',
        extraKeywords: [t.fullName, a.property?.name].filter(Boolean),
      })
    );
  }

  const announcements = await Announcement.find({ organization: orgId, isActive: true })
    .sort({ publishedAt: -1 })
    .limit(40)
    .lean();
  for (const an of announcements) {
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'announcement',
        sourceId: String(an._id),
        title: `Announcement: ${an.title}`,
        content: `${an.title} (${an.category}). ${an.body} Published ${an.publishedAt ? new Date(an.publishedAt).toLocaleDateString('en-IN') : ''}.`,
        audience: 'all',
        extraKeywords: [an.category, 'notice', 'announcement'],
      })
    );
  }

  const openTickets = await MaintenanceTicket.find({
    organization: orgId,
    status: { $in: ['open', 'in_progress', 'assigned'] },
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  for (const tk of openTickets) {
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'ticket',
        sourceId: String(tk._id),
        title: `Ticket ${tk.ticketNumber || tk._id}`,
        content: `Maintenance ticket ${tk.ticketNumber || ''}: ${tk.title || tk.category}. Status ${tk.status}. Category ${tk.category}. ${tk.description || ''}`,
        audience: 'admin',
        extraKeywords: [tk.category, tk.status, 'ticket'],
      })
    );
  }

  const reg =
    (await RegistrationLink.findOne({ organization: orgId, isMaster: true }).lean()) ||
    (await RegistrationLink.findOne({ organization: orgId }).sort({ updatedAt: -1 }).lean());
  if (reg) {
    const cfg = reg.formConfig || {};
    const toggles = [
      cfg.showEmergencyContact && 'emergency contact',
      cfg.showMoveInDate && 'move-in date',
      cfg.showRoomPreference && 'room preference',
      cfg.showOccupation && 'occupation',
      cfg.showGender && 'gender',
      cfg.showNotes && 'notes',
    ].filter(Boolean);
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'registration',
        sourceId: String(reg._id),
        title: 'Registration form',
        content: `Registration form "${cfg.title || 'Apply for a bed'}" (brand: ${cfg.brandName || appName}). Optional sections: ${toggles.join(', ') || 'standard details'}. Public link uses token on /register/:token. Applicants choose a property; admin assigns room and bed after submit.`,
        audience: 'admin',
        extraKeywords: ['registration', 'form', 'apply', 'token'],
      })
    );
  }

  const staff = await User.find({
    organization: orgId,
    role: { $ne: 'tenant' },
    isActive: { $ne: false },
  })
    .select('fullName email role')
    .lean();
  if (staff.length) {
    docs.push(
      chunkDoc({
        organization: orgId,
        sourceType: 'staff',
        sourceId: 'team',
        title: 'Staff team',
        content: `Staff members: ${staff
          .map((s) => `${s.fullName} (${String(s.role).replace(/_/g, ' ')})`)
          .join('; ')}.`,
        audience: 'admin',
        extraKeywords: ['staff', 'team', 'manager'],
      })
    );
  }

  const rentDue = await RentRecord.countDocuments({
    organization: orgId,
    status: { $in: ['pending', 'overdue', 'partial'] },
  }).catch(() => 0);
  const activeTenants = await Tenant.countDocuments({
    organization: orgId,
    status: 'active',
  }).catch(() => Tenant.countDocuments({ organization: orgId }));

  docs.push(
    chunkDoc({
      organization: orgId,
      sourceType: 'stats',
      sourceId: 'snapshot',
      title: 'Live occupancy snapshot',
      content: `Live snapshot: ${properties.length} active properties, ${rooms.length} rooms, ${beds.length} active beds, ${activeTenants} tenants, ${assignments.length} active/upcoming assignments, ${openTickets.length} open maintenance tickets, ${rentDue} rent records due/overdue/partial, ${announcements.length} active announcements indexed.`,
      audience: 'admin',
      extraKeywords: ['stats', 'occupancy', 'how many', 'count', 'overview'],
    })
  );

  const fingerprints = await upsertChunks(orgId, docs);
  keep.push(...fingerprints);

  // Remove stale chunks for this org not in this run
  await KnowledgeChunk.deleteMany({
    organization: orgId,
    fingerprint: { $nin: keep },
  });

  return { chunks: keep.length, properties: properties.length, rooms: rooms.length };
}

let indexing = false;
let lastIndexAt = null;
let lastIndexResult = null;

async function reindexAll() {
  if (indexing) return { skipped: true, reason: 'already indexing' };
  indexing = true;
  try {
    const orgs = await Organization.find({ isActive: { $ne: false } }).lean();
    const results = [];
    for (const org of orgs) {
      results.push({ org: org.name, ...(await indexOrganization(org)) });
    }
    lastIndexAt = new Date();
    lastIndexResult = results;
    return { ok: true, at: lastIndexAt, results };
  } finally {
    indexing = false;
  }
}

function getIndexStatus() {
  return {
    indexing,
    lastIndexAt,
    lastIndexResult,
  };
}

module.exports = {
  reindexAll,
  indexOrganization,
  getIndexStatus,
  tokenize,
};
