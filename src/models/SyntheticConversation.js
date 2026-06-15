const mongoose = require('mongoose');

const syntheticMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['ai', 'lead', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  }
}, { _id: false });

const syntheticConversationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  messages: [syntheticMessageSchema],
  finalLeadStatus: {
    type: String,
    default: 'novo'
  },
  conversationState: {
    type: String,
    default: 'DISCOVERY'
  },
  methodology: {
    type: String,
    default: 'Default'
  },
  score: {
    type: Number,
    default: 0
  },
  insights: [String],
  duration: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

syntheticConversationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SyntheticConversation', syntheticConversationSchema);
