const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['ai', 'human', 'lead', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  channel: {
    type: String,
    enum: ['email', 'whatsapp', 'chat', 'linkedin', 'voice'], // <-- MODIFICAÇÃO 1
    required: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
});

const conversationSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  instance: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppInstance',
  },
  messages: [messageSchema],
  processedMessageIds: [{
    type: String
  }],
  processedStatusIds: [{
    type: String
  }],
  unreadCount: {
    type: Number,
    default: 0
  },
  sentCount: {
    type: Number,
    default: 0
  },
  deliveredCount: {
    type: Number,
    default: 0
  },
  readCount: {
    type: Number,
    default: 0
  },
  lastReadAt: Date,
  lastMessageAt: Date,
  lastInboundMessageAt: Date,
  lastOutboundMessageAt: Date,
  notes: [{
    type: String,
    default: []
  }],
  status: {
    type: String,
    enum: ['active', 'closed', 'escalated'],
    default: 'active'
  },
  channel: {
    type: String,
    enum: ['email', 'whatsapp', 'chat', 'linkedin', 'voice'], // <-- MODIFICAÇÃO 2
    required: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  handedOffToHuman: {
    type: Boolean,
    default: false
  },
  handedOffAt: Date,
  schedulingAttempt: {
    status: {
      type: String,
      enum: ['pending', 'proposed', 'confirmed', 'failed', 'negotiating'],
      default: 'pending'
    },
    proposedTimes: [Date],
    scheduledEventId: String,
  },
  aiEnabled: {
    type: Boolean,
    default: true
  },
  followup: {
    attempts: {
      type: Number,
      default: 0
    },
    nextAttemptAt: {
      type: Date,
      default: null
    }
  },
  conversationState: { type: String, default: 'DISCOVERY' },
}, {
  timestamps: true
});

conversationSchema.index({ lead: 1 });
conversationSchema.index({ status: 1 });
conversationSchema.index({ user: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
