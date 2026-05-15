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

  /**
   * Gera um resumo conciso de uma conversa para handoff ao atendente humano.
   * @param {Array} messages - Array de mensagens da conversa [{role, content}]
   * @param {object} leadData - Dados do devedor (nome, empresa, status)
   * @returns {Promise<string>} Resumo em texto da conversa
   */
  async summarizeConversation(messages, leadData = {}) {
    if (!messages || messages.length === 0) {
      return 'Nenhuma mensagem disponível para resumo.';
    }

    // Limita a últimas 30 mensagens para evitar estouro de tokens
    const recentMessages = messages.slice(-30);
    const history = recentMessages
      .map(m => {
        const role = m.role === 'ai' ? 'Agente' : m.role === 'lead' ? 'Cliente' : 'Sistema';
        return `${role}: ${m.content}`;
      })
      .join('\n');

    const prompt = `Você é um assistente de suporte. Gere um resumo conciso e objetivo desta conversa de cobrança para que um atendente humano possa assumir o atendimento rapidamente.

**Dados do cliente:**
- Nome: ${leadData.name || 'Não informado'}
- Empresa/Credor: ${leadData.company || 'Não informado'}
- Status: ${leadData.status || 'Não informado'}

**Histórico da conversa:**
${history}

**Instruções:**
1. Resuma em no máximo 5 frases objetivas.
2. Destaque: motivo do contato, postura do cliente, propostas feitas, e o que motivou a escalação para humano.
3. Se houve menção a valores, datas ou condições de pagamento, inclua esses dados.
4. Finalize com uma sugestão de como o atendente deve prosseguir.
5. Responda APENAS com o resumo, sem introduções ou comentários.`;

    try {
      return await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, max_tokens: 350 }
      );
    } catch (error) {
      logger.error('Erro ao gerar resumo da conversa:', error);
      return 'Não foi possível gerar o resumo automático desta conversa.';
    }
  }

  /**
   * Gera uma mensagem de follow-up inteligente baseada no contexto da conversa.
   * @param {Array} messages - Histórico de mensagens da conversa
   * @param {object} leadData - Dados do devedor
   * @param {number} daysSinceLastContact - Dias desde o último contato
   * @returns {Promise<string>} Mensagem de follow-up personalizada
   */
  async generateFollowupMessage(messages, leadData = {}, daysSinceLastContact = 3) {
    const recentMessages = (messages || []).slice(-10);
    const history = recentMessages
      .map(m => {
        const role = m.role === 'ai' ? 'Agente' : m.role === 'lead' ? 'Cliente' : 'Sistema';
        return `${role}: ${m.content}`;
      })
      .join('\n');

    const prompt = `Você é um especialista em cobrança humanizada. Gere uma mensagem de follow-up para retomar contato com um cliente que não responde há ${daysSinceLastContact} dia(s).

**Dados do cliente:**
- Nome: ${leadData.name || 'Cliente'}
- Empresa/Credor: ${leadData.company || 'Não informado'}

**Últimas mensagens da conversa anterior:**
${history || 'Sem histórico disponível.'}

**Instruções:**
1. A mensagem deve ser curta (máximo 2 frases), natural e sem pressão.
2. Faça referência sutil ao que foi conversado antes (se houver histórico).
3. Demonstre que está à disposição para ajudar.
4. Não use linguagem agressiva, jurídica ou ameaçadora.
5. Inclua o nome do cliente se disponível.
6. Responda APENAS com o texto da mensagem, sem comentários.`;

    try {
      return await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.7, max_tokens: 120 }
      );
    } catch (error) {
      logger.error('Erro ao gerar mensagem de follow-up:', error);
      throw new Error('Erro ao gerar follow-up com IA');
    }
  }

  /**
   * Analisa o conteúdo de um documento e extrai insights relevantes para cobrança.
   * @param {string} documentText - Texto extraído do documento
   * @param {string} fileName - Nome do arquivo original
   * @returns {Promise<object>} Insights extraídos { summary, keyInsights: string[], tags: string[] }
   */
  async analyzeDocumentForInsights(documentText, fileName = '') {
    const truncatedText = documentText.substring(0, 5000); // Limita para evitar estouro

    const prompt = `Analise o seguinte documento relacionado a processos de cobrança e negociação. Extraia insights úteis que possam melhorar a abordagem com devedores.

**Documento:** ${fileName}
**Conteúdo:**
${truncatedText}

Responda em JSON válido:
{
  "summary": "Resumo do documento em 2-3 frases",
  "keyInsights": ["insight1", "insight2", "insight3"],
  "tags": ["tag1", "tag2"],
  "actionableAdvice": ["conselho1", "conselho2"]
}`;

    try {
      const raw = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, max_tokens: 400, response_format: { type: 'json_object' } }
      );
      return JSON.parse(raw);
    } catch (error) {
      logger.error('Erro ao analisar documento com IA:', error);
      throw new Error('Falha na análise do documento com IA.');
    }
  }
}

module.exports = new AiContentService();