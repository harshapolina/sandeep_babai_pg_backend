const { MaintenanceTicket } = require('../models');

async function generateTicketNumber() {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  const latest = await MaintenanceTicket.findOne({
    ticketNumber: new RegExp(`^${prefix}`),
  })
    .sort({ ticketNumber: -1 })
    .select('ticketNumber')
    .lean();

  let next = 1;
  if (latest?.ticketNumber) {
    const parts = latest.ticketNumber.split('-');
    next = Number(parts[2] || 0) + 1;
  }

  return `${prefix}${String(next).padStart(5, '0')}`;
}

function generateReceiptNumber() {
  const now = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCP-${now}-${rand}`;
}

module.exports = { generateTicketNumber, generateReceiptNumber };
