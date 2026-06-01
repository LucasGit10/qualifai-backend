const mongoose = require('mongoose');
const logger = require('../utils/logger');
const hubspotService = require('../services/hubspotService');
const pipedriveService = require('../services/pipedriveService');
const salesforceService = require('../services/salesforceService');
const rdstationService = require('../services/rdstationService');
const pipefyService = require('../services/pipefyService');
const zohoService = require('../services/zohoService');
const kommoService = require('../services/kommoService');

const syncSchema = {
  id: String,
  lastSync: Date,
  syncStatus: {
    type: String,
    enum: ['pending', 'synced', 'error'],
    default: 'pending'
  },
  syncError: String
};

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  position: {
    type: String,
    trim: true
  },
  source: {
    type: String,
    enum: [
      'form', 'linkedin', 'email', 'whatsapp', 'chat', 'paid_traffic',
      'hubspot', 'pipedrive', 'salesforce', 'rdstation', 'pipefy', 'zoho', 'kommo',
      'lusha'
    ],
    required: true
  },
  status: {
    type: String,
    trim: true,
    maxlength: 80,
    default: 'novo'
  },
  manualReportStatus: {
    type: String,
    trim: true,
    maxlength: 120
  },
  debtorNotes: [{
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  hubspot: {
    contactId: String,
    dealId: String,
    lastSync: Date,
    syncStatus: {
      type: String,
      enum: ['pending', 'synced', 'error'],
      default: 'pending'
    },
    syncError: String
  },
  pipedrive: {
    personId: String,
    dealId: String,
    lastSync: Date,
    syncStatus: {
      type: String,
      enum: ['pending', 'synced', 'error'],
      default: 'pending'
    },
    syncError: String
  },
  salesforce: { ...syncSchema, opportunityId: String },
  rdstation: syncSchema,
  pipefy: { ...syncSchema, cardId: String },
  zoho: { ...syncSchema, dealId: String },
  kommo: { ...syncSchema, dealId: String, taskId: String },

  lusha: {
    contactId: String,
    lastSync: Date,
    syncStatus: {
      type: String,
      enum: ['pending', 'synced', 'error'],
      default: 'pending'
    },
    syncError: String
  },
  
  value: {
    type: Number,
    default: 0
  },
  qualification: {
    hasDecisionPower: {
      type: Boolean,
      default: null
    },
    companyFit: {
      type: String,
      enum: ['fit', 'no_fit', 'unknown'],
      default: 'unknown'
    },
    timing: {
      type: String,
      enum: ['immediate', 'soon', 'later', 'no_timing'],
      default: 'no_timing'
    },
    budget: {
      type: String,
      enum: ['has_budget', 'no_budget', 'unknown'],
      default: 'unknown'
    }
  },
  icp: {
    segment: String,
    companySize: String,
    revenue: String
  },
  lastContact: {
    type: Date,
    default: Date.now
  },
  nextFollowUp: Date,
  nextAction: {
    type: {
      type: String,
      enum: [null, 'initial_contact', 'followup'],
      default: null
    },
    scheduledAt: Date,
    channel: {
      type: String,
      enum: ['email', 'whatsapp', 'chat', 'linkedin', 'voice'],
      default: 'whatsapp'
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000
    },
    emailSubject: {
      type: String,
      trim: true,
      maxlength: 180
    },
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MessageTemplate'
    },
    status: {
      type: String,
      enum: [null, 'scheduled', 'sent', 'cancelled', 'failed'],
      default: null
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation'
    },
    cancelIfReplied: {
      type: Boolean,
      default: true
    },
    createdAt: Date,
    sentAt: Date,
    cancelledAt: Date,
    lastError: String
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  tags: [String],
  metadata: {
    type: Map,
    of: String
  },
  socialMedia: {
    linkedin: { type: String, trim: true },
    instagram: { type: String, trim: true },
    facebook: { type: String, trim: true }
  },
  taxId: { type: String, trim: true },
  address: {
    street: String,
    number: String,
    complement: String,
    city: String,
    state: String,
    zipCode: String
  },
  contacts: [{
    type: { type: String, enum: ['phone', 'email'] },
    value: { type: String, trim: true },
    label: String,
    addedAt: { type: Date, default: Date.now }
  }],
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Índices
leadSchema.index({ email: 1, user: 1 }, { unique: true });
leadSchema.index({ status: 1 });
leadSchema.index({ source: 1 });
leadSchema.index({ user: 1 });

async function syncPlatform(lead, platformName, syncFunction, userSettings) {
    if (!userSettings?.integrations?.[platformName]?.enabled) {
        return false;
    }
    if (!lead[platformName]) {
      lead[platformName] = {};
    }
    try {
        const result = await syncFunction(lead, userSettings);
        lead[platformName].id = result.id;
        if(result.opportunityId) lead[platformName].opportunityId = result.opportunityId;
        if(result.dealId) lead[platformName].dealId = result.dealId;
        if(result.cardId) lead[platformName].cardId = result.cardId;

        lead[platformName].lastSync = new Date();
        lead[platformName].syncStatus = 'synced';
        lead[platformName].syncError = null;
        await lead.save();
        return true;
    } catch (error) {
        if (!lead[platformName]) lead[platformName] = {};
        lead[platformName].syncStatus = 'error';
        lead[platformName].syncError = error.message;
        await lead.save();
        throw error;
    }
}

leadSchema.methods.syncWithHubspot = async function(userSettings) {
  if (!userSettings?.integrations?.hubspot?.enabled) {
    return false;
  }

  try {
    if (!this.hubspot) {
      this.hubspot = {};
    }
    
    let hubspotContactId = this.hubspot.contactId;

    if (hubspotContactId) {
      try {
        await hubspotService.updateHubSpotContact(hubspotContactId, this, userSettings);
      } catch (updateError) {
        if (updateError.response && updateError.response.status === 404) {
          logger.warn(`[HubSpot] Contato ${hubspotContactId} não encontrado (404) para o lead ${this._id}. Desvinculando.`);
          this.hubspot = undefined;
          await this.save();
          return true;
        }
        throw updateError;
      }
    } else {
      const existingContact = await hubspotService.searchHubSpotContactByEmail(this.email, userSettings);
      if (existingContact) {
        await hubspotService.updateHubSpotContact(existingContact.id, this, userSettings);
        this.hubspot.contactId = existingContact.id;
      } else {
        const newContact = await hubspotService.createHubSpotContact(this, userSettings);
        this.hubspot.contactId = newContact.id;
      }
    }

    this.hubspot.lastSync = new Date();
    this.hubspot.syncStatus = 'synced';
    this.hubspot.syncError = null;
    await this.save();
    return true;

  } catch (error) {
    logger.error(`[HubSpot] Erro ao sincronizar lead ${this._id}:`, error.response?.data || error.message);
    if (!this.hubspot) this.hubspot = {};
    this.hubspot.syncStatus = 'error';
    this.hubspot.syncError = error.response?.data?.message || error.message;
    await this.save();
    throw error;
  }
};

leadSchema.methods.syncWithPipedrive = async function(userSettings) {
  if (!userSettings?.integrations?.pipedrive?.enabled) {
    return false;
  }

  try {
    if (!this.pipedrive) {
      this.pipedrive = {};
    }

    let personId = this.pipedrive.personId;

    if (personId) {
      try {
        await pipedriveService.updatePipedrivePerson(personId, this, userSettings);
      } catch (updateError) {
        if (updateError.response && updateError.response.status === 404) {
          logger.warn(`[Pipedrive] Pessoa ${personId} não encontrada (404) para o lead ${this._id}. Desvinculando.`);
          this.pipedrive = undefined;
          await this.save();
          return true;
        }
        throw updateError;
      }
    } else {
      const person = await pipedriveService.createOrUpdatePipedrivePerson(this, userSettings);
      this.pipedrive.personId = person.data.id;
    }

    this.pipedrive.lastSync = new Date();
    this.pipedrive.syncStatus = 'synced';
    this.pipedrive.syncError = null;
    await this.save();
    return true;

  } catch (error) {
    logger.error(`[Pipedrive] Erro ao sincronizar lead ${this._id}:`, error.response?.data || error.message);
    if (!this.pipedrive) this.pipedrive = {};
    this.pipedrive.syncStatus = 'error';
    this.pipedrive.syncError = error.response?.data?.error || error.message;
    await this.save();
    throw error;
  }
};

leadSchema.methods.syncWithSalesforce = function(userSettings) {
    return syncPlatform(this, 'salesforce', salesforceService.createOrUpdateSalesforceLead, userSettings);
};

leadSchema.methods.syncWithRDStation = function(userSettings) {
    return syncPlatform(this, 'rdstation', rdstationService.createOrUpdateRDStationContact, userSettings);
};

leadSchema.methods.syncWithPipefy = function(userSettings) {
    return syncPlatform(this, 'pipefy', pipefyService.createPipefyCard, userSettings);
};

leadSchema.methods.syncWithZoho = function(userSettings) {
    return syncPlatform(this, 'zoho', zohoService.createOrUpdateZohoLead, userSettings);
};

leadSchema.methods.syncWithKommo = function(userSettings) {
    const settingsWithUser = { ...userSettings, userId: userSettings.userId || this.user };
    return syncPlatform(this, 'kommo', kommoService.createOrUpdateKommoContact, settingsWithUser);
};

module.exports = mongoose.model('Lead', leadSchema);
