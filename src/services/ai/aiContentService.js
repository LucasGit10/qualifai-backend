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

  /**
   * Infere o mapeamento de colunas de uma planilha de contatos para campanhas.
   * @param {{ headers: string[], sampleRows: object[], channel: string, currentMapping?: object }} params
   * @returns {Promise<object>} { mapping, confidence, reasoning }
   */
  async inferCampaignContactColumns({ headers = [], sampleRows = [], channel, currentMapping = {} }) {
    const allowedFields = ['name', 'phone', 'email', 'company', 'position', 'segment', 'city', 'notes'];
    const sample = sampleRows.slice(0, 8).map(row => (
      Object.fromEntries(headers.map(header => [header, row?.[header] ?? '']))
    ));

    const prompt = `Voce ajuda a importar contatos para campanhas de cobranca. Mapeie os cabecalhos recebidos para campos internos.

Canal da campanha: ${channel}
Cabecalhos existentes: ${JSON.stringify(headers)}
Mapeamento ja identificado por regras: ${JSON.stringify(currentMapping)}
Amostra de linhas: ${JSON.stringify(sample)}

Campos internos permitidos:
- name: nome do contato/devedor
- phone: telefone ou WhatsApp
- email: email
- company: empresa, credor ou razao social
- position: cargo ou funcao
- segment: segmento, setor ou ramo
- city: cidade
- notes: observacoes ou comentarios

Responda APENAS com JSON valido neste formato:
{
  "mapping": {
    "name": "cabecalho exato ou null",
    "phone": "cabecalho exato ou null",
    "email": "cabecalho exato ou null",
    "company": "cabecalho exato ou null",
    "position": "cabecalho exato ou null",
    "segment": "cabecalho exato ou null",
    "city": "cabecalho exato ou null",
    "notes": "cabecalho exato ou null"
  },
  "confidence": 0,
  "reasoning": "explicacao curta"
}

Regras:
- Use somente cabecalhos que existem exatamente em Cabecalhos existentes.
- Nao invente cabecalho.
- Para WhatsApp, telefone/WhatsApp e nome sao obrigatorios.
- Para email, email e nome sao obrigatorios.
- Se nao tiver certeza, use null para aquele campo.`;

    try {
      const raw = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.1, max_tokens: 500, response_format: { type: 'json_object' } }
      );

      let cleanRaw = raw.trim();
      if (cleanRaw.startsWith('```')) {
        cleanRaw = cleanRaw.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(cleanRaw);
      const headerSet = new Set(headers);
      const mapping = {};

      allowedFields.forEach(field => {
        const inferredHeader = parsed?.mapping?.[field];
        mapping[field] = inferredHeader && headerSet.has(inferredHeader) ? inferredHeader : null;
      });

      const confidence = Number.isFinite(Number(parsed.confidence))
        ? Math.max(0, Math.min(100, Number(parsed.confidence)))
        : null;

      return {
        mapping,
        confidence,
        reasoning: parsed.reasoning || '',
      };
    } catch (error) {
      logger.error('Erro ao inferir colunas de campanha com IA:', error);
      throw new Error('Falha ao inferir colunas de campanha com IA.');
    }
  }

  /**
   * Gera um snapshot operacional da negociacao para orientar o atendente.
   * @param {object} params
   * @param {object} params.conversation - Conversa com messages[]
   * @param {object} params.lead - Lead/devedor
   * @param {Array} params.debts - Dividas associadas
   * @returns {Promise<object>} Inteligencia de negociacao
   */
  async analyzeNegotiationStrategy({ conversation, lead, debts = [], userSettings = {} }) {
    const recentMessages = (conversation.messages || []).slice(-30);
    const history = recentMessages
      .map(m => {
        const role = m.role === 'ai' ? 'Agente' : m.role === 'lead' ? 'Cliente' : m.role === 'human' ? 'Atendente' : 'Sistema';
        return `${role}: ${m.content}`;
      })
      .join('\n');

    const debtContext = debts.length
      ? debts.map(d => `- Contrato ${d.contractNumber || 'S/N'}: saldo R$ ${d.currentBalance || 0}, original R$ ${d.originalAmount || 0}, status ${d.status || 'ativo'}`).join('\n')
      : `- Valor conhecido no lead: R$ ${lead.value || 0}`;
    const aiConfig = userSettings?.aiConfig || {};
    const negotiationRules = [
      aiConfig.negotiationRules ? JSON.stringify(aiConfig.negotiationRules) : null,
      aiConfig.maxDiscount ? `Desconto maximo permitido: ${aiConfig.maxDiscount}` : null,
      aiConfig.maxInstallments ? `Parcelamento maximo permitido: ${aiConfig.maxInstallments}` : null,
      aiConfig.minimumDownPayment ? `Entrada minima: ${aiConfig.minimumDownPayment}` : null,
      aiConfig.prompt ? `Diretriz do operador: ${aiConfig.prompt}` : null,
    ].filter(Boolean).join('\n') || 'Sem regras comerciais estruturadas cadastradas.';

    const prompt = `VocÃª Ã© um estrategista sÃªnior de cobranÃ§a humanizada. Analise a conversa e gere um painel tÃ¡tico para o atendente decidir a prÃ³xima melhor aÃ§Ã£o.

Dados do cliente:
- Nome: ${lead.name || 'NÃ£o informado'}
- Empresa: ${lead.company || 'NÃ£o informado'}
- Status do lead: ${lead.status || 'NÃ£o informado'}
- Canal: ${conversation.channel || 'NÃ£o informado'}

DÃ­vidas:
${debtContext}

Regras comerciais e limites configurados:
${negotiationRules}

HistÃ³rico recente:
${history || 'Sem histÃ³rico disponÃ­vel.'}

Responda APENAS com JSON vÃ¡lido, neste formato:
{
  "temperature": "quente|morno|frio|critico|desconhecido",
  "agreementProbability": 0,
  "mood": "estado emocional em poucas palavras",
  "mainObjection": "principal objeÃ§Ã£o ou barreira",
  "riskLevel": "baixo|medio|alto|critico|desconhecido",
  "recommendedAction": "aÃ§Ã£o recomendada para o atendente",
  "recommendedProposal": "proposta objetiva e plausÃ­vel, sem inventar desconto se nÃ£o houver regra",
  "suggestedMessage": "mensagem curta pronta para enviar ao cliente",
  "avoid": ["coisas que o atendente deve evitar"],
  "humanSummary": "resumo executivo em atÃ© 3 frases",
  "flags": ["alertas como contestacao, juridico, vulnerabilidade, pedido_humano, oportunidade"],
  "nextStep": "prÃ³ximo passo operacional"
}

Regras:
- NÃ£o invente valores de desconto, juros, boleto ou condiÃ§Ãµes que nÃ£o estejam no contexto.
- Se nÃ£o houver informaÃ§Ã£o suficiente, recomende coletar o dado faltante.
- Em risco emocional, jurÃ­dico, falecimento, contestaÃ§Ã£o forte ou pedido para parar contato, marque riskLevel como alto ou critico e recomende humano.
- A suggestedMessage deve ser natural para WhatsApp, com no mÃ¡ximo 2 frases.`;

    try {
      const raw = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.25, max_tokens: 700, response_format: { type: 'json_object' } }
      );

      let cleanRaw = raw.trim();
      if (cleanRaw.startsWith('```')) {
        cleanRaw = cleanRaw.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(cleanRaw);
      const clampProbability = Number.isFinite(Number(parsed.agreementProbability))
        ? Math.max(0, Math.min(100, Number(parsed.agreementProbability)))
        : null;

      return {
        temperature: ['quente', 'morno', 'frio', 'critico', 'desconhecido'].includes(parsed.temperature) ? parsed.temperature : 'desconhecido',
        agreementProbability: clampProbability,
        mood: parsed.mood || 'NÃ£o identificado',
        mainObjection: parsed.mainObjection || 'Ainda nÃ£o identificada',
        riskLevel: ['baixo', 'medio', 'alto', 'critico', 'desconhecido'].includes(parsed.riskLevel) ? parsed.riskLevel : 'desconhecido',
        recommendedAction: parsed.recommendedAction || 'Revisar a conversa antes de prosseguir.',
        recommendedProposal: parsed.recommendedProposal || 'Sem proposta recomendada no momento.',
        suggestedMessage: parsed.suggestedMessage || '',
        avoid: Array.isArray(parsed.avoid) ? parsed.avoid.slice(0, 6) : [],
        humanSummary: parsed.humanSummary || 'Resumo indisponÃ­vel.',
        flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 8) : [],
        nextStep: parsed.nextStep || 'Definir prÃ³ximo contato.',
        analyzedAt: new Date(),
        source: 'ai',
      };
    } catch (error) {
      logger.error('Erro ao gerar inteligencia de negociacao:', error);
      throw new Error('Falha ao gerar inteligencia de negociacao.');
    }
  }
}

module.exports = new AiContentService();
