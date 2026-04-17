const mongoose = require('mongoose');

const debtSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  contractNumber: {
    type: String,
    required: true,
    trim: true
  },
  originalAmount: {
    type: Number,
    required: true
  },
  currentBalance: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['ativo', 'judicial', 'liquidado', 'cancelado'],
    default: 'ativo'
  },
  interestRate: {
    type: Number,
    default: 1.0 // 1% ao mês, por exemplo
  },
  penaltyRate: {
    type: Number,
    default: 2.0 // 2% de multa fixa, por exemplo
  },
  correctionIndex: {
    type: String,
    enum: ['IPCA', 'IGP-M', 'SELIC', 'FIXO'],
    default: 'FIXO'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Debt', debtSchema);
