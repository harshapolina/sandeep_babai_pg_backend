const mongoose = require('mongoose');

const knowledgeChunkSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      required: true,
      index: true,
      enum: [
        'help',
        'organization',
        'property',
        'room',
        'bed',
        'tenant',
        'announcement',
        'payment_policy',
        'ticket',
        'registration',
        'staff',
        'stats',
      ],
    },
    sourceId: { type: String, default: '', index: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
    /** who may retrieve this chunk */
    audience: {
      type: String,
      enum: ['all', 'admin', 'tenant'],
      default: 'all',
      index: true,
    },
    keywords: [{ type: String, trim: true, lowercase: true }],
    fingerprint: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

knowledgeChunkSchema.index({ organization: 1, sourceType: 1, sourceId: 1 });
knowledgeChunkSchema.index(
  { title: 'text', content: 'text', keywords: 'text' },
  { weights: { title: 5, keywords: 3, content: 1 }, name: 'knowledge_text' }
);

module.exports = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
