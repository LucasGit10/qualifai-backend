// services/ai/aiContentService.js
// Geração de conteúdo de formato longo: relatórios de performance e templates de campanha.
const { chatCompletion } = require('./handlers/chat.handler');
const logger = require('../../utils/logger');

class AiContentService {
  /**
   * Gera um resumo de performance inteligente para envio por email ou WhatsApp.
   * @param {object} reportData - { data, recipient: { role, channel }, periodText }
   * @returns {Promise<string>} HTML (email) ou texto formatado (WhatsApp)
   */
  async generatePerformanceSummary(reportData) {
    const { data, recipient, periodText } = reportData;
    const { role, channel } = recipient;
    const topSourcesText = data.topLeadSources.map(s => `${s.source} (${s.count})`).join(', ') || 'N/A';

    const prompt = `
Você é um analista de resultados sênior. Crie um resumo de performance conciso e inteligente em Português do Brasil. Adapte para a audiência (${role}) e o canal (${channel}).

**Dados do período (${periodText}):**
- Devedores Novos: ${data.newLeads}
- Acordos Fechados: ${data.meetingsScheduled}
- Em Negociação: ${data.opportunitiesCreated}
- Principais Fontes: ${topSourcesText}
- Taxa de Resposta: ${data.cadenceResponseRate}%
- Tempo Médio de Resposta: ${data.avgSdrResponseTime}

**Instruções:**
1. Identifique os pontos mais relevantes.
2. Gere 2-3 insights de IA com base nos dados.
3. Forneça 2-3 recomendações acionáveis para o próximo período.
4. Tom para 'manager': operacional e tático. Tom para 'c-level': estratégico.
5. Para 'email': HTML limpo com <h2>, <p>, <ul><li>, <hr>. NÃO inclua <html>, <head> ou <body>.
   Para 'whatsapp': texto estruturado com emojis e negrito (*texto*). Seja conciso.

Comece o resumo agora.
    `;

    try {
      return await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.6, max_tokens: 400 }
      );
    } catch (error) {
      logger.error('Erro ao gerar resumo de performance:', error);
      throw new Error('Falha ao gerar resumo com a IA.');
    }
  }

  /**
   * Gera um template de mensagem de campanha de cobrança.
   * @param {{ name: string, description: string, channel: string }} params
   * @returns {Promise<string>} Texto do template
   */
  async generateCampaignTemplate({ name, description, channel }) {
    const prompt = `Você é um especialista em comunicação de cobrança. Crie um template de mensagem profissional para a seguinte campanha:
*Nome:* ${name}
*Descrição:* ${description}
*Canal:* ${channel}

*Instruções:*
- A mensagem deve ser cordial, clara e profissional.
- Adapte o tom para o canal: WhatsApp é mais direto, E-mail é mais estruturado.
- OBRIGATÓRIO incluir variáveis: {nome} e {empresa}.
- Responda APENAS com o texto do template, sem introdução ou comentários.
- Não gere conteúdo inapropriado ou ofensivo.`;

    try {
      return await chatCompletion(
        [{ role: 'user', content: prompt }],
        { max_tokens: 200 }
      );
    } catch (error) {
      logger.error('Erro ao gerar template de campanha:', error);
      throw new Error('Erro ao gerar template com IA');
    }
  }
}

module.exports = new AiContentService();