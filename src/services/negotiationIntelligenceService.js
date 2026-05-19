const { getModel } = require('../utils/modelProvider');
const Conversation = getModel('Conversation');
const Debt = getModel('Debt');
const User = getModel('User');
const aiService = require('./aiService');
const logger = require('../utils/logger');

const populateConversation = (query) => query
  .populate('lead', 'name email company phone position status value')
  .populate('instance', 'instanceName phoneNumber')
  .populate('assignedTeamMember', 'name roleLabel');

class NegotiationIntelligenceService {
  async refreshConversation({ conversationId, userId, io = null }) {
    const conversation = await populateConversation(
      Conversation.findOne({ _id: conversationId, user: userId })
    );

    if (!conversation) {
      const error = new Error('Conversa nao encontrada');
      error.statusCode = 404;
      throw error;
    }

    if (!conversation.lead) {
      const error = new Error('Lead associado nao encontrado');
      error.statusCode = 404;
      throw error;
    }

    const user = await User.findById(userId);
    const debts = await Debt.find({ lead: conversation.lead._id, user: userId });
    const intelligence = await aiService.analyzeNegotiationStrategy({
      conversation,
      lead: conversation.lead,
      debts,
      userSettings: user?.settings || {},
    });

    conversation.negotiationIntelligence = intelligence;

    const criticalFlags = new Set(['pedido_humano', 'juridico', 'falecimento', 'vulnerabilidade', 'parar_contato']);
    const hasCriticalFlag = (intelligence.flags || []).some(flag => criticalFlags.has(String(flag).toLowerCase()));
    const shouldAutoEscalate = intelligence.riskLevel === 'critico' || hasCriticalFlag;

    if (shouldAutoEscalate && conversation.aiEnabled !== false) {
      conversation.aiEnabled = false;
      conversation.status = 'escalated';
      conversation.handedOffToHuman = true;
      conversation.handedOffAt = new Date();
      conversation.messages.push({
        role: 'system',
        content: '[SISTEMA] A Central Inteligente pausou a IA e recomendou atendimento humano por risco sensivel na negociacao.',
        channel: conversation.channel,
        metadata: {
          source: 'negotiation_intelligence',
          riskLevel: intelligence.riskLevel,
          flags: intelligence.flags || [],
        },
      });
    }

    await conversation.save();

    const populatedConversation = await populateConversation(
      Conversation.findById(conversation._id)
    );

    io?.to(`user-${userId}`).emit(shouldAutoEscalate ? 'conversation_escalated' : 'conversation_updated', {
      conversation: populatedConversation,
      reason: 'negotiation_intelligence_updated',
    });

    return {
      intelligence,
      conversation: populatedConversation,
    };
  }

  refreshConversationInBackground({ conversationId, userId, io = null }) {
    setImmediate(() => {
      this.refreshConversation({ conversationId, userId, io })
        .catch((error) => {
          logger.error(`[Negotiation Intelligence] Falha ao atualizar conversa ${conversationId}:`, error);
        });
    });
  }
}

module.exports = new NegotiationIntelligenceService();
