const express = require('express');
const { Notification } = require('../models');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = { user: req.user._id };
    if (req.query.unread === 'true') query.isRead = false;

    const items = await Notification.find(query).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false,
    });

    res.json({ success: true, data: items, unreadCount });
  })
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const item = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!item) throw new AppError('Notification not found', 404);
    item.isRead = true;
    item.readAt = new Date();
    await item.save();
    res.json({ success: true, data: item });
  })
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true });
  })
);

module.exports = router;
