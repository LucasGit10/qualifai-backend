const mongoose = require('mongoose');

const complianceDocumentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  originalName: { type: String, required: true, trim: true },
  filename: { type: String, required: true, trim: true },
  path: { type: String, required: true },
  mimeType: { type: String, required: true, trim: true },
  size: { type: Number, required: true },
  notes: { type: String, trim: true, maxlength: 2000 },
  status: {
    type: String,
    enum: ['active', 'replaced'],
    default: 'active'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

complianceDocumentSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('ComplianceDocument', complianceDocumentSchema);
