// services/ai/aiChatService.js
// Serviço de chat de cobrança. Orquestra prompts + handler Gemini.
const { chatCompletion } = require('./handlers/chat.handler');
const {
  buildCollectionSystemPrompt,
  buildLandingPagePrompt,
  mapConversationToChatMessages,
} = require('./prompts/collection.prompts');
const logger = require('../../utils/logger');
const { getModel } = require('../../utils/modelProvider');

class AiChatService {
  constructor() {
    this._Debt = null;
  }

  _getDebtModel() {
    if (!this._Debt) {
      this._Debt = getModel('Debt');
    }
    return this._Debt;
  }
  /**
   * Gera resposta para o chat da landing page pública.
   * @param {Array} conversationHistory - Histórico de mensagens
   * @param {string} customPrompt - Prompt personalizado com regras [INTENT:SCHEDULE]
   * @returns {Promise<string>} Resposta bruta da IA (pode conter tokens de intent)
   */
  async generateLandingPageResponse(conversationHistory, customPrompt) {
    try {
      const systemPrompt = buildLandingPagePrompt(customPrompt);
      const messages = [
        { role: 'system', content: systemPrompt },
        ...mapConversationToChatMessages(conversationHistory),
      ];
      return await chatCompletion(messages, { max_tokens: 150, temperature: 0.7 });
    } catch (error) {
      logger.error('Erro em generateLandingPageResponse:', error);
      throw new Error('Erro ao gerar resposta para a landing page');
    }
  }

  /**
   * Gera resposta do agente de cobrança para uma conversa ativa.
   * @param {object} conversation - Objeto da conversa (com messages[])
   * @param {object} leadData - Dados do devedor
   * @param {object} userSettings - Configurações da IA do usuário
   * @returns {Promise<{reply: string, action: string}>} JSON com resposta e ação
   */
  async generateResponse(conversation, leadData, userSettings) {
    try {
      const aiConfig = userSettings?.aiConfig || userSettings?.settings?.aiConfig || {};
      
      // Injeta o nome da empresa do operador/credor no aiConfig para o prompt usar
      if (!aiConfig.companyName) {
        aiConfig.companyName = userSettings?.company?.name || userSettings?.settings?.company?.name || '';
      }

      // Busca as dívidas do lead para dar contexto à IA
      let debtContext = "Nenhuma dívida detalhada encontrada.";
      try {
        const Debt = this._getDebtModel();
        if (leadData && leadData._id) {
          const debts = await Debt.find({ lead: leadData._id });
          if (debts && debts.length > 0) {
            debtContext = debts.map(d => 
              `- Contrato: ${d.contractNumber || 'S/N'}, Valor Original: R$ ${d.originalAmount || 0}, Saldo Atual: R$ ${d.currentBalance || 0}, Status: ${d.status || 'ativo'}`
            ).join('\n');
          } else if (leadData.value) {
            // Fallback para o valor global do lead se não houver dívidas detalhadas
            debtContext = `- Valor Total da Pendência: R$ ${leadData.value}`;
          }
        }
      } catch (debtError) {
        logger.error('[AI Chat] Erro ao buscar dívidas:', debtError);
      }

      const systemPrompt = buildCollectionSystemPrompt(aiConfig, leadData, conversation.channel);

      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'system',
          content: `### DADOS DO DEVEDOR PARA NEGOCIAÇÃO:
Nome: ${leadData.name}
Empresa: ${leadData.company || 'N/A'}
Email: ${leadData.email || 'N/A'}
Telefone: ${leadData.phone || 'N/A'}
Status Atual: ${leadData.status || 'novo'}

### DETALHAMENTO DAS DÍVIDAS:
${debtContext}`,
        },
        ...conversation.messages.map(msg => ({
          role: msg.role === 'ai' ? 'assistant' : 'user',
          content: msg.content,
        })),
      ];

      const raw = await chatCompletion(messages, {
        max_tokens: 1000,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      // Limpeza de blocos de código markdown se existirem
      let cleanRaw = raw.trim();
      if (cleanRaw.startsWith('```')) {
        cleanRaw = cleanRaw.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(cleanRaw);
      logger.info('[AI Cobrança] Resposta:', parsed);

      if (!parsed.reply || !parsed.action) {
        throw new Error('Resposta da IA não está no formato JSON esperado.');
      }

      if (parsed.action === 'request_human') {
        parsed.escalate = true;
      }
      if (parsed.action === 'end_conversation') {
        parsed.endCall = true;
        parsed.conversationState = parsed.conversationState || 'DISMISSED';
      }
      if (parsed.action === 'propose_agreement') {
        parsed.leadStatus = parsed.leadStatus || 'em_negociacao';
        parsed.conversationState = parsed.conversationState || 'NEGOTIATION';
      }
      if (!parsed.leadStatus) {
        parsed.leadStatus = leadData.status || 'contatado';
      }
      if (!parsed.conversationState) {
        parsed.conversationState = conversation.conversationState || 'DISCOVERY';
      }
      parsed.escalate = parsed.escalate === true;
      parsed.endCall = parsed.endCall === true;
      parsed.proposeScheduling = parsed.proposeScheduling === true;

      return parsed;
    } catch (error) {
      logger.error('Erro no generateResponse (Detalhado):', {
        message: error.message,
        stack: error.stack,
        data: error.response?.data
      });
      return {
        reply: null,
        action: 'disable_ai',
        aiUnavailable: true,
        error: error.message || 'Erro desconhecido no processamento da IA',
      };
    }
  }
}

module.exports = new AiChatService();
