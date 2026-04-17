// services/ai/aiChatService.js
// Serviço de chat de cobrança. Orquestra prompts + handler OpenAI.
const { chatCompletion } = require('./handlers/chat.handler');
const {
  buildCollectionSystemPrompt,
  buildLandingPagePrompt,
  mapConversationToOpenAI,
} = require('./prompts/collection.prompts');
const logger = require('../../utils/logger');

class AiChatService {
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
        ...mapConversationToOpenAI(conversationHistory),
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
      const aiConfig = userSettings?.aiConfig || {};
      const systemPrompt = buildCollectionSystemPrompt(aiConfig, leadData);

      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'system',
          content: `Devedor: Nome: ${leadData.name}, Empresa/Credor: ${leadData.company}, Status: ${leadData.status || 'novo'}`,
        },
        ...conversation.messages.map(msg => ({
          role: msg.role === 'ai' ? 'assistant' : 'user',
          content: msg.content,
        })),
      ];

      const raw = await chatCompletion(messages, {
        max_tokens: 150,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(raw);
      logger.info('[AI Cobrança] Resposta:', parsed);

      if (!parsed.reply || !parsed.action) {
        throw new Error('Resposta da IA não está no formato JSON esperado.');
      }

      return parsed;
    } catch (error) {
      logger.error('Erro no generateResponse:', error);
      return {
        reply: 'Desculpe, tive um problema para processar sua mensagem. Poderia repetir, por favor?',
        action: 'continue_conversation',
      };
    }
  }
}

module.exports = new AiChatService();