const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const uploadRoot = process.env.VERCEL
  ? path.join('/tmp', process.env.UPLOAD_DIR || 'uploads')
  : path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');

['private', 'temp'].forEach((dir) => {
  const full = path.join(uploadRoot, dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(uploadRoot, 'private'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, key);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP, and PDF files are allowed'));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadRoot };
