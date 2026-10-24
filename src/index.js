require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { connectDB } = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { uploadRoot } = require('./middleware/upload');

const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const propertyRoutes = require('./routes/property.routes');
const roomRoutes = require('./routes/room.routes');
const registrationRoutes = require('./routes/registration.routes');
const tenantRoutes = require('./routes/tenant.routes');
const ticketRoutes = require('./routes/ticket.routes');
const paymentRoutes = require('./routes/payment.routes');
const staffRoutes = require('./routes/staff.routes');
const announcementRoutes = require('./routes/announcement.routes');
const notificationRoutes = require('./routes/notification.routes');
const reportRoutes = require('./routes/report.routes');
const tenantPortalRoutes = require('./routes/tenantPortal.routes');
const settingsRoutes = require('./routes/settings.routes');
const chatRoutes = require('./routes/chat.routes');
const { authenticate } = require('./middleware/auth');
const { AppError } = require('./utils/AppError');
const { reindexAll } = require('./services/ragIndexService');
const fs = require('fs');

const app = express();
const isVercel = Boolean(process.env.VERCEL);

function corsOrigin(origin, cb) {
  const raw = process.env.CLIENT_URL || 'http://localhost:5173';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || allowed.includes('*') || allowed.includes(origin)) {
    return cb(null, true);
  }
  // Allow Vercel preview deployments of the frontend project
  if (/^https:\/\/[\w.-]+\.vercel\.app$/.test(origin)) {
    return cb(null, true);
  }
  return cb(null, false);
}

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'has-tracker-api',
    emailConfigured: process.env.EMAIL_ENABLED === 'true',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tenant-portal', tenantPortalRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/chat', chatRoutes);

app.get(
  '/api/files/:key',
  authenticate,
  (req, res, next) => {
    const key = path.basename(req.params.key);
    const filePath = path.join(uploadRoot, 'private', key);
    if (!fs.existsSync(filePath)) {
      return next(new AppError('File not found', 404));
    }
    res.sendFile(filePath);
  }
);

app.use(notFound);
app.use(errorHandler);

async function startLocal() {
  const PORT = process.env.PORT || 5000;
  await connectDB();
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
    if (process.env.EMAIL_ENABLED !== 'true') {
      console.log(
        'Email notifications: DISABLED (set EMAIL_ENABLED=true and SMTP_* to enable)'
      );
    }
  });

  const runIndex = () =>
    reindexAll()
      .then((r) => {
        if (!r.skipped) {
          console.log(
            `RAG index refreshed: ${(r.results || [])
              .map((x) => `${x.org}(${x.chunks})`)
              .join(', ')}`
          );
        }
      })
      .catch((err) => console.warn('RAG reindex failed:', err.message));

  setTimeout(runIndex, 2500);
  setInterval(runIndex, 10 * 60 * 1000);
}

if (!isVercel) {
  startLocal().catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = app;
