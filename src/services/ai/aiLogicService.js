// Usar a IA para tarefas de classificação e decisão que retornam dados estruturados (e não uma resposta de chat).
const openai = require('./openAIClient');
const logger = require('../../utils/logger');

class AiLogicService {

  async classifyLead(conversation, leadData, userSettings) {
    const aiConfig = userSettings?.aiConfig || {};
    
    const formatCriteria = (criteria, defaultCriteria) => {
      let criteriaList = criteria;

      if (!Array.isArray(criteriaList) || criteriaList.length === 0) {
        if (typeof criteriaList === 'string' && criteriaList) {
          criteriaList = criteriaList.split('\n').map(c => c.replace(/^- /, '').trim()).filter(Boolean);
        } else {
          criteriaList = defaultCriteria;
        }
      }
      return criteriaList.map(c => `- ${c}`).join('\n');
    };

    const hotCriteria = formatCriteria(aiConfig.hotCriteria, ['Ocupa cargo de decisão (C-level, Diretor, Gerente).', 'A empresa parece ter o perfil ideal para a solução.', 'Demonstra necessidade clara e urgência.', 'Menciona ter orçamento disponível.']);
    const warmCriteria = formatCriteria(aiConfig.warmCriteria, ['Atende a 1 ou 2 critérios de \'Quente\'.', 'Influenciador, mas não decisor final.', 'Demonstra interesse, mas o timing não é imediato.']);
    const coldCriteria = formatCriteria(aiConfig.coldCriteria, ['Não tem poder de decisão.', 'A empresa não se encaixa no perfil.', 'Não demonstra necessidade ou interesse claro.']);
    
    const systemPrompt = `
Você é um sistema de análise de leads de alta precisão. Sua única função é analisar o histórico de uma conversa e as informações de um lead, e classificá-lo estritamente como 'QUENTE', 'MORNO' ou 'FRIO'.
*REGRAS DE SAÍDA (OBRIGATÓRIO):*
1.  Sua resposta DEVE conter APENAS uma das três palavras: QUENTE, MORNO, ou FRIO.
2.  NÃO inclua nenhuma explicação, pontuação, ou texto adicional. Sua resposta deve ser a palavra e nada mais.
3.  Use os critérios fornecidos como seu guia principal para a classificação.
`;
    const userCriteria = `
### CRITÉRIOS DE CLASSIFICAÇÃO
*QUENTE:* Para ser classificado como QUENTE, o lead precisa atender à **MAIORIA** dos seguintes critérios. Um único critério não é suficiente.
${hotCriteria}
*MORNO:*
${warmCriteria}
*FRIO:*
${coldCriteria}
`;
    const history = conversation.messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    const analysisRequest = `
### DADOS PARA ANÁLISE
*Histórico da Conversa:*
${history}
*Informações do Lead:*
- Nome: ${leadData.name}
- Empresa: ${leadData.company}
- Cargo: ${leadData.position || 'Não informado'}
### TAREFA
Com base nos critérios e nos dados acima, forneça a classificação do lead.
`;
    const fullPrompt = systemPrompt + userCriteria + analysisRequest;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: fullPrompt }],
        max_tokens: 5,
        temperature: 0.0,
      });

      const classification = response.choices[0].message.content.trim().toUpperCase();
      
      if (['QUENTE', 'MORNO', 'FRIO'].includes(classification)) {
        return classification.toLowerCase();
      } else {
        logger.warn(`Classificação inesperada da IA: "${classification}". Usando 'morno' como fallback.`);
        return 'morno';
      }
    } catch (error) {
      logger.error('Erro ao classificar lead:', error);
      return 'morno';
    }
  }

  async detectHumanHandoffRequest(leadMessage) {
    try {
        const systemPrompt = `
Sua tarefa é identificar se a mensagem do cliente é um pedido explícito para falar com uma pessoa, e não mais com a IA.
Analise a mensagem e responda APENAS com "SIM" ou "NÃO".

**Responda "SIM" somente se a mensagem contiver frases como:**
- "Quero falar com um humano"
- "Posso falar com um especialista?"
- "Me passe para um vendedor"
- "Chega de robô, quero uma pessoa"

**Responda "NÃO" para perguntas gerais, mesmo que demonstrem interesse, como:**
- "Como funciona?"
- "Qual o próximo passo?"
- "Estou interessado, o que fazemos agora?"
- "Podemos agendar uma demonstração?"

Sua resposta deve ser **exclusivamente** "SIM" ou "NÃO".`;
        
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Mensagem: "${leadMessage}"` }
            ],
            max_tokens: 3,
            temperature: 0.0,
        });

        const decision = response.choices[0].message.content.trim().toUpperCase();
        logger.info(`[Handoff Detection] Message: "${leadMessage}" -> Decision: ${decision}`);
        return decision.includes('SIM');

    } catch (error) {
        logger.error('Erro na detecção de handoff para humano:', error);
        return false;
    }
  }
}

module.exports = new AiLogicService();