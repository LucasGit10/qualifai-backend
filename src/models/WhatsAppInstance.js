const mongoose = require('mongoose');

const whatsappInstanceSchema = new mongoose.Schema({
  instanceName: {
    type: String,
    required: true
    // A propriedade 'unique' foi removida daqui e movida para um índice composto abaixo
  },
  phoneNumber: {
    type: String,
    required: true
  },
  phoneNumberId: {
    type: String,
    required: false,
    unique: true,
    sparse: true
  },

  // ==========================================================
  //  CAMPO ADICIONADO PARA CORRIGIR O PROBLEMA
  // ==========================================================
  wabaId: { // WhatsApp Business Account ID
    type: String,
    required: false // Mantido como 'false' para suportar outros tipos de instância
  },
  // ==========================================================
  
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['connecting', 'connected', 'disconnected', 'error', 'deleted'],
    default: 'connected'
  },
  lastConnection: Date,
  disconnectedAt: Date,
  deletedAt: Date,
  apiCredentials: {
    token: {
      type: String,
      required: false
    },
    apiKey: String,
    instanceId: String
  },

   // QR Code
  qrCode: String,
  
  // Dados da Evolution API
  evolutionData: {
    type: mongoose.Schema.Types.Mixed
  },
  webhookEvents: [{
    type: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    data: {
      type: mongoose.Schema.Types.Mixed
    }
  }],
  messagesSent: {
    type: Number,
    default: 0
  },
  messagesReceived: {
    type: Number,
    default: 0
  },
  historySync: {
    status: {
      type: String,
      enum: ['idle', 'syncing', 'completed', 'declined', 'error'],
      default: 'idle'
    },
    progress: {
      type: Number,
      default: 0
    },
    phase: Number,
    lastChunkOrder: Number,
    lastSyncedAt: Date,
    lastError: String
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
// ALTERADO: Índice composto para garantir que instanceName seja único POR USUÁRIO
whatsappInstanceSchema.index({ instanceName: 1, user: 1 }, { unique: true });
whatsappInstanceSchema.index({ status: 1 });
whatsappInstanceSchema.index({ user: 1, status: 1 });
whatsappInstanceSchema.index({ phoneNumberId: 1 }, { sparse: true });


// Virtual para verificar se está ativa
whatsappInstanceSchema.virtual('isActive').get(function() {
  return ['connected', 'connecting'].includes(this.status);
});

// Virtual para verificar se pode ser reativada
whatsappInstanceSchema.virtual('canReactivate').get(function() {
  return this.status === 'deleted';
});

// Método para incrementar contador de mensagens
whatsappInstanceSchema.methods.incrementMessageCount = function(type) {
  if (type === 'sent') {
    this.messagesSent += 1;
  } else if (type === 'received') {
    this.messagesReceived += 1;
  }
  return this.save();
};

// Método para adicionar evento webhook
whatsappInstanceSchema.methods.addWebhookEvent = function(eventType, eventData) {
  const type = typeof eventType === 'string' ? eventType : (eventType?.event || 'UNKNOWN');

  this.webhookEvents.push({
    type: type,
    timestamp: new Date(),
    data: eventData
  });

  // Manter apenas os últimos 20 eventos para não sobrecarregar o banco
  if (this.webhookEvents.length > 20) {
    this.webhookEvents = this.webhookEvents.slice(-20);
  }

  return this.save();
};

module.exports = mongoose.model('WhatsAppInstance', whatsappInstanceSchema);
