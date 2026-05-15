const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'sales', 'manager'],
    default: 'sales'
  },
  managedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  plan: {
    type: String,
    enum: ['guest', 'basic', 'medium', 'pro'],
    default: 'guest'
  },
  company: {
    name: String,
    domain: String
  },
  taxId: {
    type: {
      type: String,
      enum: ['CPF', 'CNPJ'],
    },
    number: {
      type: String,
      trim: true,
      unique: true,
      sparse: true
    }
  },
  stripe: {
    customerId: String,
    subscriptionId: String,
    planId: String,
    priceId: String,
    subscriptionStatus: String,
    currentPeriodEnd: Date,
  },
  mercadoPago: {
    customerId: String,
    subscriptionId: String,
    planId: String,
    status: String,
    lastPaymentDate: Date,
    nextPaymentDate: Date,
    environment: {
      type: String,
      enum: ['live', 'test'],
      default: 'live',
    },
  },
  settings: {
    theme: {
      type: String,
      enum: ['dark', 'light'],
      default: 'dark'
    },
    conversationView: {
      type: String,
      enum: ['cards', 'chat'],
      default: 'cards'
    },
    debtorStatuses: {
      type: [String],
      default: []
    },
    debtorTags: {
      type: [String],
      default: []
    },
    performanceReport: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'daily' },
      deliveryChannels: [{ type: String, enum: ['email', 'whatsapp'] }],
      recipients: [{
        _id: false,
        name: String,
        email: String,
        whatsappNumber: String,
        role: { type: String, enum: ['manager', 'c-level'], default: 'manager' }
      }]
    },
    businessWhatsAppNumber: String,

    
    twilioConfig: {
      twilioAccountSid: { type: String, trim: true },
      twilioAuthToken: { type: String, trim: true },
      twilioPhoneNumber: { type: String, trim: true }
    },
    aiConfig: {
      agentName: {
        type: String,
        default: 'Assistente Virtual'
      },
      assignConversation: {
        type: Boolean,
        default: true
      },
      communicationStyle: {
        type: String,
        enum: ['Normal', 'Formal', 'Casual'],
        default: 'Normal'
      },
      language: {
        type: String,
        default: 'Português do Brasil'
      },
      companyIndustry: {
        type: String,
      },
      personality: {
        type: String,
        default: 'professional'
      },
      maxInteractions: {
        type: Number,
        default: 5
      },
      responseDelay: {
        type: Number,
        default: 60
      },
      prompt:{
        type: String,
        default: `Você é um SDR (Sales Development Representative) virtual profissional e simpático.
Sua função é:
1. Abordar leads de forma educada e profissional
2. Fazer perguntas de qualificação (cargo, empresa, necessidade, timing)
3. Se o lead parecer qualificado, solicite o email e o nome da empresa para o agendamento.
4. Classificar leads como quente, morno, frio ou convertido
5. Encaminhar leads qualificados para vendedores humanos ou iniciar o agendamento de reunião.

Diretrizes:
- Use linguagem informal mas educada
- Seja direto e objetivo
- Personalize com nome da pessoa sempre que possível
- Mantenha mensagens curtas (máximo 2 parágrafos)
- Se perguntado, informe que é uma Atendente Virtual da QualifAI
- Não forneça preços ou condições comerciais
- Encerre educadamente leads desqualificados

Exemplo de abordagem inicial:
"Oi [Name]! Vi que você se interessou pelo nosso material sobre [Tema]. Como posso te ajudar?"`
      },
      salesMethodology: {
        type: String,
        enum: [
          'acolhedor',
          'equilibrado',
          'resolutivo',
          'amigavel',
          'neutro',
          'persistente',
          'Default',
          'SPICED',
          'SPIN',
          'BANT',
          'MEDDIC',
          'QUALIFAI'
        ],
        default: 'equilibrado'
      },
      enableAutonomousSwitching: {
        type: Boolean,
        default: false // Começa desativado por segurança
      },
      hotCriteria: {
        type: [String],
        default: [
          "Ocupa cargo de decisão (C-level, Diretor, Gerente).",
          "A empresa parece ter o perfil ideal para a solução.",
          "Demonstra necessidade clara e urgência.",
          "Menciona ter orçamento disponível."
        ]
      },
      warmCriteria: {
        type: [String],
        default: [
          "Atende a 1 ou 2 critérios de 'Quente'.",
          "Influenciador, mas não decisor final.",
          "Demonstra interesse, mas o timing não é imediato."
        ]
      },
      coldCriteria: {
        type: [String],
        default: [
          "Não tem poder de decisão.",
          "A empresa não se encaixa no perfil.",
          "Não demonstra necessidade ou interesse claro."
        ]
      },
      enableVoiceInteraction: {
        type: Boolean,
        default: false,
      },
      voiceModel: {
        type: String,
        enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
        default: 'alloy',
      },
      followup: {
        enabled: {
          type: Boolean,
          default: false
        },
        waitPeriod: {
          type: Number,
          default: 24
        },
        waitUnit: {
          type: String,
          enum: ['hours', 'days'], // ALTERADO
          default: 'hours'
        },
        maxAttempts: {
          type: Number,
          default: 2
        },
        message: {
          type: String,
          default: 'Olá [Name], tudo bem? Só passando para saber se você teve a chance de ver minha mensagem anterior. Se tiver qualquer dúvida, estou à disposição!'
        }
      }
    },
    qualificationCriteria: {
      mustHaveDecisionPower: {
        type: Boolean,
        default: true
      },
      icpCriteria: {
        segments: [String],
        companySizes: [String]
      }
    },
    integrations: {
      whatsappProvider: { 
        type: String, 
        enum: ['evolution', 'zapi','whatsapp'], 
        default: 'whatsapp' 
      },
      hubspot: {
        apiKey: String,
        enabled: Boolean
      },
      pipedrive: {
        refreshToken: String,
        apiDomain: String,
        enabled: Boolean
      },
      salesforce: {
        clientId: String,
        clientSecret: String,
        refreshToken: String,
        instanceUrl: String,
        enabled: Boolean
      },
      rdstation: {
        privateToken: String,
        enabled: Boolean
      },
      pipefy: {
        apiKey: String,
        pipelineId: String,
        enabled: Boolean,
        fieldMappings: [{
          qualifaiField: String,
          pipefyFieldId: String,
        }]
      },
      zoho: {
        clientId: String,
        clientSecret: String,
        refreshToken: String,
        apiDomain: String,
        enabled: Boolean
      },
      kommo: {
        subdomain: String,
        clientId: String,
        clientSecret: String,
        refreshToken: String,
        enabled: Boolean
      },
      google: {
        enabled: Boolean,
        refreshToken: String,
        userEmail: String,
      },
      instagram: {
        enabled: { type: Boolean, default: false },
        pageId: { type: String, trim: true },
        pageName: { type: String, trim: true },
        accessToken: { type: String }
      },
      whatsapp: {
        apiKey: String,
        enabled: Boolean
      },
      smtp: {
        enabled: Boolean,
        provider: String,
        host: String,
        port: Number,
        secure: Boolean,
        auth: {
          user: String,
          pass: String
        }
      },
      zapi: {
        enabled: Boolean,
        instanceId: String,
        token: String,
        phoneNumber: String
      }
    }
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true
  },
  oneSignalSubscriptionId: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error);
    }
  }
  next();
});

userSchema.pre('save', async function(next) {
  if (this.isModified('taxId.number') && this.taxId.number) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.taxId.number = await bcrypt.hash(this.taxId.number, salt);
    } catch (error) {
      return next(error);
    }
  }
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.compareTaxId = async function(candidateTaxId) {
  if (!this.taxId.number || !candidateTaxId) {
    return false;
  }
  return bcrypt.compare(candidateTaxId, this.taxId.number);
};

module.exports = mongoose.model('User', userSchema);
