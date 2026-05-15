// prompts/classification.prompts.js
// Funções puras que constroem os prompts de classificação de prioridade de devedores.

const DEFAULT_HOT_CRITERIA = [
  'Confirmou a dívida de forma clara.',
  'Demonstrou intenção imediata de quitar ou negociar.',
  'Solicitou opções de parcelamento ou boleto.',
  'Propôs um valor ou data de pagamento.',
];

const DEFAULT_WARM_CRITERIA = [
  'Reconheceu a dívida, mas mencionou dificuldades financeiras.',
  'Demonstrou interesse em regularizar, mas não definiu prazo.',
  'Pediu para retornar a ligação ou contato em outro momento.',
];

const DEFAULT_COLD_CRITERIA = [
  'Não reconhece a dívida ou contesta o valor.',
  'Recusa-se explicitamente a negociar ou realizar o pagamento.',
  'Evita responder perguntas básicas sobre a regularização.',
];

function formatCriteriaList(criteria, defaults) {
  let list = criteria;
  if (!Array.isArray(list) || list.length === 0) {
    if (typeof list === 'string' && list) {
      list = list.split('\n').map(c => c.replace(/^- /, '').trim()).filter(Boolean);
    } else {
      list = defaults;
    }
  }
  return list.map(c => `- ${c}`).join('\n');
}

/**
 * Constrói o prompt completo para classificação de prioridade do devedor.
 * @param {object} aiConfig - Critérios configurados pelo usuário
 * @param {object} leadData - Dados do devedor
 * @param {Array} conversationMessages - Histórico da conversa
 * @returns {string} Prompt completo
 */
function buildClassificationPrompt(aiConfig = {}, leadData = {}, conversationMessages = []) {
  const hotCriteria  = formatCriteriaList(aiConfig.hotCriteria,  DEFAULT_HOT_CRITERIA);
  const warmCriteria = formatCriteriaList(aiConfig.warmCriteria, DEFAULT_WARM_CRITERIA);
  const coldCriteria = formatCriteriaList(aiConfig.coldCriteria, DEFAULT_COLD_CRITERIA);

  const systemPrompt = `
Você é um sistema de análise de devedores e priorização de cobrança. Sua única função é analisar o histórico de uma conversa e classificar o devedor como 'QUENTE' (Alta), 'MORNO' (Média) ou 'FRIO' (Baixa).
*REGRAS DE SAÍDA (OBRIGATÓRIO):*
1. Sua resposta DEVE conter APENAS uma das três palavras: QUENTE, MORNO, ou FRIO.
2. NÃO inclua nenhuma explicação, pontuação, ou texto adicional.
3. Use os critérios fornecidos como seu guia principal.
`;

  const criteria = `
### CRITÉRIOS DE PRIORIZAÇÃO
*QUENTE (Alta Prioridade):* O devedor demonstra real abertura para pagamento ou acordo.
${hotCriteria}
*MORNO (Média Prioridade):*
${warmCriteria}
*FRIO (Baixa Prioridade):*
${coldCriteria}
`;

  const history = conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n');

  const analysisRequest = `
### DADOS PARA ANÁLISE
*Histórico da Conversa:*
${history}
*Informações do Devedor:*
- Nome: ${leadData.name || 'Não informado'}
- Empresa: ${leadData.company || 'Não informado'}
### TAREFA
Com base nos critérios e nos dados acima, forneça a classificação de prioridade do devedor.
`;

  return systemPrompt + criteria + analysisRequest;
}

/**
 * Constrói o prompt para detectar se o devedor quer falar com humano.
 * @returns {string} System prompt de detecção de handoff
 */
function buildHandoffDetectionPrompt() {
  return `
Sua tarefa é identificar se a mensagem do cliente é um pedido explícito para falar com uma pessoa, e não mais com a IA.
Analise a mensagem e responda APENAS com "SIM" ou "NÃO".

**Responda "SIM" se a mensagem contiver frases ou intenções como:**
- "Quero falar com um humano"
- "Posso falar com um especialista?"
- "Me passe para um atendente"
- "Aguardo o contato"
- "Pode me ligar"
- "Quero falar com uma pessoa"
- "Certo, aguardo" (em resposta a uma oferta de contato humano)

**Responda "NÃO" para perguntas gerais, mesmo que demonstrem interesse.**

Sua resposta deve ser exclusivamente "SIM" ou "NÃO".`;
}

module.exports = {
  buildClassificationPrompt,
  buildHandoffDetectionPrompt,
};
