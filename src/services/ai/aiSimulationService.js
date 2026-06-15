// services/ai/aiSimulationService.js
// Serviço de treinamento sintético da IA.
// Gera conversas simuladas para treinar e avaliar o agente de cobrança.

const { chatCompletion } = require('./handlers/chat.handler');
const logger = require('../../utils/logger');

let _status = { running: false, lastRunAt: null, lastResult: null };

class AiSimulationService {
  constructor() {
    // Lazy-load models para evitar problemas de import circular
    this._SyntheticConversation = null;
    this._ConversationInsight = null;
  }

  _getModels() {
    if (!this._SyntheticConversation) {
      const { getModel } = require('../../utils/modelProvider');
      this._SyntheticConversation = getModel('SyntheticConversation');
      this._ConversationInsight = getModel('ConversationInsight');
    }
    return {
      SyntheticConversation: this._SyntheticConversation,
      ConversationInsight: this._ConversationInsight,
    };
  }

  getStatus() {
    return { ..._status };
  }

  /**
   * Executa um ciclo de treinamento sintético.
   * Gera conversas simuladas com personas diversas e avalia o desempenho do agente.
   * @param {string} userId - ID do usuário
   * @returns {Promise<object>} Resultado do ciclo
   */
  async startTrainingCycle(userId) {
    if (_status.running) {
      return { message: 'Um ciclo de treinamento já está em andamento.', status: 'already_running' };
    }

    _status.running = true;
    _status.lastRunAt = new Date();

    try {
      const { SyntheticConversation, ConversationInsight } = this._getModels();
      const scenarios = this._generateScenarios();
      const results = [];

      for (const scenario of scenarios) {
        try {
          const conversation = await this._runSimulation(scenario);

          const syntheticConv = new SyntheticConversation({
            user: userId,
            messages: conversation.messages,
            finalLeadStatus: conversation.finalStatus,
            conversationState: conversation.finalState,
            methodology: scenario.methodology || 'Default',
            score: conversation.score,
            insights: conversation.insights,
            duration: conversation.messages.length,
          });
          await syntheticConv.save();

          // Armazena insights se a conversa foi bem-sucedida
          if (conversation.score >= 70) {
            const insight = new ConversationInsight({
              user: userId,
              type: 'synthetic',
              success: true,
              summary: `Simulação bem-sucedida com persona "${scenario.persona}". Score: ${conversation.score}/100.`,
              keyPoints: conversation.insights,
              effectiveStrategies: conversation.effectiveStrategies || [],
              source: 'synthetic_training',
              tags: [scenario.persona, scenario.methodology || 'default'],
            });
            await insight.save();
          }

          results.push({
            scenario: scenario.persona,
            score: conversation.score,
            status: conversation.finalStatus,
          });

        } catch (scenarioError) {
          logger.error(`[Synthetic] Erro no cenário "${scenario.persona}":`, scenarioError);
          results.push({
            scenario: scenario.persona,
            score: 0,
            status: 'error',
            error: scenarioError.message,
          });
        }
      }

      const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

      _status.lastResult = {
        scenarios: results.length,
        avgScore: Math.round(avgScore),
        results,
        completedAt: new Date(),
      };

      return {
        message: 'Ciclo de treinamento concluído.',
        status: 'completed',
        ..._status.lastResult,
      };

    } catch (error) {
      logger.error('[Synthetic] Erro no ciclo de treinamento:', error);
      throw error;
    } finally {
      _status.running = false;
    }
  }

  /**
   * Gera cenários de simulação com personas diversas.
   */
  _generateScenarios() {
    return [
      {
        persona: 'cooperativo',
        description: 'Cliente que reconhece a dívida e quer negociar',
        firstMessage: 'Oi, vi que tenho uma pendência. Qual o valor? Consigo parcelar?',
      },
      {
        persona: 'resistente',
        description: 'Cliente que contesta a dívida e está irritado',
        firstMessage: 'Não devo nada! Já paguei isso. Para de me ligar!',
      },
      {
        persona: 'evasivo',
        description: 'Cliente que evita o assunto e dá respostas vagas',
        firstMessage: 'Hmmm... tá, depois eu vejo isso.',
      },
      {
        persona: 'dificuldade_financeira',
        description: 'Cliente com dificuldade financeira real e emotivo',
        firstMessage: 'Eu sei da dívida, mas perdi o emprego e não tenho como pagar agora. Estou muito preocupado.',
      },
    ];
  }

  /**
   * Executa uma simulação de conversa completa.
   */
  async _runSimulation(scenario) {
    const messages = [];
    const maxTurns = 5;
    let currentMessage = scenario.firstMessage;

    // System prompt para o avaliador (persona do devedor)
    const personaPrompt = `Você está simulando um devedor com o perfil "${scenario.persona}": ${scenario.description}. 
Responda de forma realista e consistente com este perfil. Mantenha respostas curtas (1-2 frases).
Use linguagem informal e natural em Português do Brasil.`;

    for (let turn = 0; turn < maxTurns; turn++) {
      // Mensagem do devedor
      messages.push({ role: 'lead', content: currentMessage });

      // Resposta do agente de cobrança
      const agentPrompt = `Você é um agente de cobrança humanizado. Responda de forma empática e profissional à mensagem do devedor.
Histórico: ${messages.map(m => `${m.role}: ${m.content}`).join('\n')}
Responda APENAS com a mensagem do agente (sem JSON, sem prefixo).`;

      const agentReply = await chatCompletion(
        [{ role: 'user', content: agentPrompt }],
        { max_tokens: 120, temperature: 0.7 }
      );
      messages.push({ role: 'ai', content: agentReply });

      // Gera próxima resposta do devedor (se não for o último turno)
      if (turn < maxTurns - 1) {
        const debtorReply = await chatCompletion(
          [
            { role: 'system', content: personaPrompt },
            ...messages.map(m => ({
              role: m.role === 'lead' ? 'user' : 'assistant',
              content: m.content,
            })),
          ],
          { max_tokens: 80, temperature: 0.8 }
        );
        currentMessage = debtorReply;
      }
    }

    // Avaliação final
    const evaluationPrompt = `Avalie esta conversa de cobrança em uma escala de 0-100 considerando:
1. Empatia e tom respeitoso (0-25)
2. Eficácia em propor soluções (0-25)
3. Progresso na negociação (0-25)
4. Adesão às boas práticas de cobrança humanizada (0-25)

Conversa:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Responda APENAS com JSON: {"score": <número>, "insights": ["insight1", "insight2"], "finalStatus": "qualificado|contatado|frio", "finalState": "CONVERTED|DISCOVERY|DISMISSED", "effectiveStrategies": ["estratégia1"]}`;

    try {
      const evalRaw = await chatCompletion(
        [{ role: 'user', content: evaluationPrompt }],
        { max_tokens: 300, temperature: 0.2, response_format: { type: 'json_object' } }
      );

      const evaluation = JSON.parse(evalRaw);
      return {
        messages,
        score: evaluation.score || 50,
        insights: evaluation.insights || [],
        finalStatus: evaluation.finalStatus || 'contatado',
        finalState: evaluation.finalState || 'DISCOVERY',
        effectiveStrategies: evaluation.effectiveStrategies || [],
      };
    } catch (evalError) {
      logger.warn('[Synthetic] Falha ao avaliar simulação:', evalError);
      return {
        messages,
        score: 50,
        insights: ['Avaliação automática falhou'],
        finalStatus: 'contatado',
        finalState: 'DISCOVERY',
        effectiveStrategies: [],
      };
    }
  }
}

module.exports = new AiSimulationService();
