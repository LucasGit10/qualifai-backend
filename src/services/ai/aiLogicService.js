// services/ai/aiLogicService.js
// Serviço de lógica de classificação e decisão. Orquestra prompts + handler OpenAI.
const { chatCompletion } = require('./handlers/chat.handler');
const {
  buildClassificationPrompt,
  buildHandoffDetectionPrompt,
} = require('./prompts/classification.prompts');
const logger = require('../../utils/logger');

class AiLogicService {
  /**
   * Classifica a prioridade de um devedor: 'quente', 'morno' ou 'frio'.
   * @param {object} conversation - Objeto da conversa
   * @param {object} leadData - Dados do devedor
   * @param {object} userSettings - Configurações da IA
   * @returns {Promise<'quente'|'morno'|'frio'>}
   */
  async classifyLead(conversation, leadData, userSettings) {
    const aiConfig = userSettings?.aiConfig || {};
    const fullPrompt = buildClassificationPrompt(
      aiConfig,
      leadData,
      conversation.messages
    );

    try {
      const raw = await chatCompletion(
        [{ role: 'user', content: fullPrompt }],
        { max_tokens: 5, temperature: 0.0 }
      );

      const classification = raw.toUpperCase();

      if (['QUENTE', 'MORNO', 'FRIO'].includes(classification)) {
        return classification.toLowerCase();
      }

      logger.warn(`Classificação inesperada: "${classification}". Fallback: morno.`);
      return 'morno';
    } catch (error) {
      logger.error('Erro ao classificar devedor:', error);
      return 'morno';
    }
  }

  /**
   * Detecta se o devedor quer falar com um humano.
   * @param {string} leadMessage - Mensagem do devedor
   * @returns {Promise<boolean>}
   */
  async detectHumanHandoffRequest(leadMessage) {
    try {
      const systemPrompt = buildHandoffDetectionPrompt();
      const raw = await chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Mensagem: "${leadMessage}"` },
        ],
        { max_tokens: 3, temperature: 0.0 }
      );

      const decision = raw.toUpperCase();
      logger.info(`[Handoff Detection] "${leadMessage}" → ${decision}`);
      return decision.includes('SIM');
    } catch (error) {
      logger.error('Erro na detecção de handoff:', error);
      return false;
    }
  }
}

module.exports = new AiLogicService();