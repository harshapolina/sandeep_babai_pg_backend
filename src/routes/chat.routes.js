const express = require('express');
const { KnowledgeChunk, Organization } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { answerQuestion } = require('../services/ragChatService');
const { reindexAll, getIndexStatus, indexOrganization } = require('../services/ragIndexService');

const router = express.Router();

router.use(authenticate);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const org = await Organization.findById(req.auth.organizationId).select(
      'settings.chatbot settings.appName name'
    );
    const count = await KnowledgeChunk.countDocuments({
      organization: req.auth.organizationId,
    });
    const bot = org?.settings?.chatbot || {};
    res.json({
      success: true,
      data: {
        enabled: bot.enabled !== false,
        provider: bot.provider || 'auto',
        hasApiKey: Boolean(bot.hasApiKey),
        chunkCount: count,
        appName: org?.settings?.appName || org?.name,
        index: getIndexStatus(),
      },
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const question = String(req.body?.message || req.body?.question || '').trim();
    if (!question) throw new AppError('Message is required', 400);
    if (question.length > 1000) throw new AppError('Message too long', 400);

    const isAdmin = req.user.role !== 'tenant';
    const result = await answerQuestion({
      organizationId: req.auth.organizationId,
      question,
      isAdmin,
      userName: req.user.fullName,
    });

    res.json({
      success: true,
      data: result,
    });
  })
);

router.post(
  '/reindex',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const org = await Organization.findById(req.auth.organizationId);
    if (!org) throw new AppError('Organization not found', 404);
    const result = await indexOrganization(org.toObject ? org.toObject() : org);
    res.json({
      success: true,
      message: `Knowledge refreshed (${result.chunks} chunks)`,
      data: { ...result, index: getIndexStatus() },
    });
  })
);

router.post(
  '/reindex-all',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await reindexAll();
    res.json({ success: true, message: 'Full reindex complete', data: result });
  })
);

module.exports = router;
