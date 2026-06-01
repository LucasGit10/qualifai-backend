// src/models/MessageTemplate.js
const mongoose = require('mongoose');

const messageTemplateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, match: /^[a-z0-9_]+$/ },
  category: { type: String, required: true, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'] },
  language: { type: String, required: true, default: 'pt_BR' },
  emailSubject: { type: String, trim: true, maxlength: 180 },
  emailPreheader: { type: String, trim: true, maxlength: 220 },

  // ==========================================================
  //  COLUNA ADICIONADA AQUI
  // ==========================================================
  templateType: {
    type: String,
    required: true,
    enum: ['conversation', 'follow_up', 'email'],
    default: 'conversation'
  },
  // ==========================================================

  components: [{
    type: { type: String, required: true, enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'] },
    format: { type: String }, // Para HEADER: TEXT, IMAGE, DOCUMENT, VIDEO
    text: { type: String },
    buttons: [{
      type: { type: String, required: true, enum: ['QUICK_REPLY', 'URL'] },
      text: { type: String, required: true },
      url: { type: String }, // Apenas para botões de URL
    }]
  }],
  status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'], default: 'draft' },
  metaTemplateId: { type: String }, // ID retornado pela Meta
  sampleMediaUrl: { type: String },
  rejectionReason: { type: String }
}, { timestamps: true });

messageTemplateSchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
