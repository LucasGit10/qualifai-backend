const mongoose = require('mongoose');

const guarantorSchema = new mongoose.Schema({
  debt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Debt',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  taxId: {
    type: String, // CPF ou CNPJ
    trim: true
  },
  relationship: {
    type: String,
    enum: ['fiador', 'avalista', 'outro'],
    default: 'fiador'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Guarantor', guarantorSchema);
