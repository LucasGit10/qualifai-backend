const { getModel } = require('../utils/modelProvider');
const Lead = getModel('Lead');
const Conversation = getModel('Conversation');
const User = getModel('User');
const WhatsAppInstance = getModel('WhatsAppInstance');
const aiController = require('../controllers/ai/ai.controller');
const logger = require('../utils/logger');
const socketHub = require('../utils/socketHub');
const { findReusableConversation, touchOutboundConversation } = require('./conversationReuseService');
const AppError = require('../utils/AppError');
const { hasActiveComplianceDocument } = require('./complianceService');

function renderTemplate(value = '', lead = {}) {
  const variables = {
    nome: lead.name || '',
    cliente: lead.name || '',
    email: lead.email || '',
    telefone: lead.phone || '',
    empresa: lead.company || '',
    contrato: lead.metadata?.get?.('contrato') || lead.metadata?.contrato || '',
    empreendimento: lead.metadata?.get?.('empreendimento') || lead.metadata?.empreendimento || '',
    valor_total: lead.value ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.value) : ''
  };

  return String(value || '').replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_match, key) => variables[key] || '');
}

class NextActionService {
  async processScheduledInitialContacts() {
    try {
      const now = new Date();
      const leads = await Lead.find({
        'nextAction.type': 'initial_contact',
        'nextAction.status': 'scheduled',
        'nextAction.scheduledAt': { $lte: now }
      }).populate('user');

      for (const lead of leads) {
        await this.processLead(lead);
      }
    } catch (error) {
      logger.error('[NextAction] Erro ao processar acoes agendadas:', error);
    }
  }

  async processLead(lead) {
    const action = lead.nextAction || {};
    const user = lead.user;
    const channel = action.channel || 'whatsapp';
    const message = renderTemplate(action.message || '', lead).trim();
    const emailSubject = renderTemplate(action.emailSubject || 'Contato sobre seu contrato', lead).trim();

    try {
      if (!user || !message) {
        throw new AppError('Lead sem usuário associado ou sem mensagem agendada configurada.', 422, 'LEAD_NO_USER_OR_MESSAGE');
      }

      if (!(await hasActiveComplianceDocument(user))) {
        throw new AppError('Documento de permissao/base legal ausente. Envio agendado bloqueado ate anexar o comprovante.', 403, 'COMPLIANCE_DOCUMENT_REQUIRED');
      }

      if (channel === 'whatsapp' && !lead.phone) {
        throw new AppError(`Lead ${lead.name || lead._id} não possui número de telefone cadastrado para envio via WhatsApp.`, 422, 'LEAD_NO_PHONE');
      }

      if (channel === 'email' && !lead.email) {
        throw new AppError(`Lead ${lead.name || lead._id} não possui endereço de e-mail cadastrado para envio.`, 422, 'LEAD_NO_EMAIL');
      }

      const provider = user.settings?.integrations?.whatsappProvider || 'whatsapp';
      const instance = channel === 'whatsapp' && provider === 'whatsapp'
        ? await WhatsAppInstance.findOne({ user: user._id, status: 'connected' })
        : null;

      if (channel === 'whatsapp' && provider === 'whatsapp' && !instance) {
        throw new AppError('Nenhuma instância do WhatsApp conectada para este usuário. Conecte uma instância nas configurações.', 503, 'NO_WHATSAPP_INSTANCE');
      }

      let conversation = await findReusableConversation({ userId: user._id, leadId: lead._id, channel });

      if (!conversation) {
        conversation = new Conversation({
          lead: lead._id,
          user: user._id,
          channel,
          instance: instance?._id,
          status: 'active',
          aiEnabled: true,
          messages: []
        });
      } else if (instance && !conversation.instance) {
        conversation.instance = instance._id;
      }

      await aiController.sendMessageToChannel(
        lead,
        { type: 'text', content: message, subject: emailSubject },
        channel,
        user.settings,
        instance || conversation.instance
      );

      touchOutboundConversation(conversation, {
        channel,
        instanceId: instance?._id,
        message: { role: 'ai', content: message }
      });
      await conversation.save();

      lead.status = 'contatado';
      lead.lastContact = new Date();
      lead.nextFollowUp = undefined;
      lead.nextAction.status = 'sent';
      lead.nextAction.sentAt = new Date();
      lead.nextAction.conversation = conversation._id;
      lead.nextAction.lastError = undefined;
      await lead.save();

      const io = socketHub.getIO();
      if (io) {
        io.to(`user-${user._id.toString()}`).emit('conversation_updated', { conversation });
        io.to(`user-${user._id.toString()}`).emit('lead_updated', { lead });
      }
    } catch (error) {
      lead.nextAction.status = 'failed';
      lead.nextAction.lastError = error.message;
      await lead.save();
      logger.error(`[NextAction] Falha ao iniciar conversa do lead ${lead._id}:`, error);
    }
  }
}

module.exports = new NextActionService();
