const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  roleLabel: {
    type: String,
    trim: true,
    default: 'Atendente'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

teamMemberSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
