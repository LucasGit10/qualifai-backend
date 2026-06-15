const mongoose = require('mongoose');

const installmentSchema = new mongoose.Schema({
  debt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Debt',
    required: true
  },
  number: {
    type: Number,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  paidAt: Date,
  status: {
    type: String,
    enum: ['pendente', 'pago', 'atrasado', 'negociado', 'cancelado'],
    default: 'pendente'
  },
  paymentMethod: {
    type: String,
    enum: ['pix', 'boleto', 'cash', 'card', 'transfer'],
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

installmentSchema.index({ debt: 1, dueDate: 1 });
installmentSchema.index({ status: 1 });

module.exports = mongoose.model('Installment', installmentSchema);
