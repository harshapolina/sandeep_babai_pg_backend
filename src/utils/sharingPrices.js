const DEFAULT_SHARING_PRICES = {
  single: 15000,
  double: 12000,
  triple: 10000,
  quad: 8000,
  dorm: 6000,
  other: 9000,
};

function normalizeSharingPrices(raw = {}) {
  const out = { ...DEFAULT_SHARING_PRICES };
  for (const key of Object.keys(DEFAULT_SHARING_PRICES)) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      const n = Number(raw[key]);
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
  }
  return out;
}

/** Map room capacity / roomType → sharing key */
function sharingKeyFromRoom({ roomType, capacity } = {}) {
  const type = String(roomType || '').toLowerCase();
  if (['single', 'double', 'triple', 'quad', 'dorm', 'other'].includes(type)) {
    return type;
  }
  const cap = Number(capacity) || 0;
  if (cap <= 1) return 'single';
  if (cap === 2) return 'double';
  if (cap === 3) return 'triple';
  if (cap === 4) return 'quad';
  if (cap >= 5) return 'dorm';
  return 'other';
}

function rentForSharing(orgOrPrices, roomLike = {}) {
  const prices =
    orgOrPrices?.settings?.sharingPrices != null
      ? normalizeSharingPrices(orgOrPrices.settings.sharingPrices)
      : normalizeSharingPrices(orgOrPrices);
  const key = sharingKeyFromRoom(roomLike);
  return prices[key] ?? prices.other ?? 0;
}

module.exports = {
  DEFAULT_SHARING_PRICES,
  normalizeSharingPrices,
  sharingKeyFromRoom,
  rentForSharing,
};
