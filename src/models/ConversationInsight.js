const mongoose = require('mongoose');

const conversationInsightSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation'
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },
  type: {
    type: String,
    enum: ['objection', 'strategy', 'pattern', 'document', 'synthetic'],
    default: 'pattern'
  },
  success: {
    type: Boolean,
    default: false
  },
  summary: {
    type: String,
    required: true
  },
  keyPoints: [String],
  objectionsHandled: [String],
  effectiveStrategies: [String],
  tags: [String],
  source: {
    type: String,
    enum: ['auto_analysis', 'document_upload', 'synthetic_training', 'manual'],
    default: 'auto_analysis'
  },
  rawData: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

conversationInsightSchema.index({ user: 1, type: 1 });
conversationInsightSchema.index({ success: 1, leadId: 1 });
conversationInsightSchema.index({ tags: 1 });

module.exports = mongoose.model('ConversationInsight', conversationInsightSchema);
