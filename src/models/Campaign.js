const mongoose = require('mongoose');

// --- ADIÇÃO INÍCIO ---
// Schema para o estado do follow-up por contato
const followUpStatusSchema = new mongoose.Schema({
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: null } // A data do próximo envio
}, { _id: false });
// --- ADIÇÃO FIM ---


const campaignContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String }, // Para WhatsApp
  email: { type: String }, // Para Email
  company: String,
  position: String,
  segment: String,
  city: String,
  notes: String,
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'replied', 'failed'],
    default: 'pending'
  },
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  repliedAt: Date,
  failureReason: String,
  messageId: String,
  response: String,
  // --- ADIÇÃO INÍCIO ---
  // Campo para controlar o follow-up deste contato
  followUpStatus: followUpStatusSchema
  // --- ADIÇÃO FIM ---
});

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Configurações da campanha
  channel: {
    type: String,
    enum: ['whatsapp', 'email', 'whatsapp_official'], 
    required: true,
    default: 'whatsapp'
  },
  emailSubject: String, 
  messageTemplate: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'MessageTemplate',
    required: true 
  },
  
  whatsappInstance: { 
    type: mongoose.Schema.Types.Mixed,
    ref: 'WhatsAppInstance' 
  },
  
  // Configurações de envio
  delayBetweenMessages: { type: Number, default: 30 }, 
  dailyLimit: { type: Number, default: 100 }, 
  workingHours: {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '18:00' }
  },
  workingDays: [{ type: Number, default: [1, 2, 3, 4, 5] }],
  
  // --- ADIÇÃO INÍCIO ---
  // Objeto com as configurações de follow-up para a campanha
  followUp: {
    enabled: { type: Boolean, default: false },
    messageTemplate: { type: String, default: 'Olá {{nome}}, tudo bem? Teria um momento para conversarmos?' }, // Mensagem de follow-up
    delay: { type: Number, default: 24 }, // Ex: 24
    delayUnit: { type: String, enum: ['hours', 'days'], default: 'hours' }, // 'hours' ou 'days'
    maxAttempts: { type: Number, default: 1 }
  },
  // --- ADIÇÃO FIM ---

  // Contatos da campanha
  contacts: [campaignContactSchema],
  
  // Status da campanha
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed'],
    default: 'draft'
  },
  
  // Estatísticas
  stats: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    replied: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  
  // Agendamento
  scheduledAt: Date,
  startedAt: Date,
  completedAt: Date,
  
  // Auto-resposta/qualificação
  autoQualification: {
    enabled: { type: Boolean, default: true },
    qualificationPrompt: String,
    followUpEnabled: { type: Boolean, default: false },
    followUpDelay: { type: Number, default: 24 }
  }
}, {
  timestamps: true
});

// Índices
campaignSchema.index({ user: 1, status: 1 });
campaignSchema.index({ user: 1, channel: 1, status: 1 });
campaignSchema.index({ 'contacts.phone': 1 });
campaignSchema.index({ 'contacts.email': 1 });
campaignSchema.index({ 'contacts.status': 1 });

// --- ADIÇÃO INÍCIO ---
// Índice para otimizar a busca por follow-ups pendentes
campaignSchema.index({ 
  status: 1, 
  'followUp.enabled': 1, 
  'contacts.status': 1, 
  'contacts.followUpStatus.nextAttemptAt': 1 
});
// --- ADIÇÃO FIM ---


// Método para atualizar estatísticas
campaignSchema.methods.updateStats = function() {
  this.stats.total = this.contacts.length;
  this.stats.sent = this.contacts.filter(c => c.status === 'sent' || c.status === 'delivered' || c.status === 'read' || c.status === 'replied').length;
  this.stats.delivered = this.contacts.filter(c => c.status === 'delivered' || c.status === 'read' || c.status === 'replied').length;
  this.stats.read = this.contacts.filter(c => c.status === 'read' || c.status === 'replied').length;
  this.stats.replied = this.contacts.filter(c => c.status === 'replied').length;
  this.stats.failed = this.contacts.filter(c => c.status === 'failed').length;
  return this.save();
};

module.exports = mongoose.model('Campaign', campaignSchema);