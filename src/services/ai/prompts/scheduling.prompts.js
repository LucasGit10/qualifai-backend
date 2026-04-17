// prompts/scheduling.prompts.js
// Funções puras que constroem os prompts de agendamento.

/**
 * Constrói o prompt para analisar a resposta do devedor sobre agendamento.
 * @param {Array} proposedTimes - Array de Date com os horários propostos
 * @param {Array} conversationMessages - Histórico da conversa
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildSchedulingParsePrompt(proposedTimes, conversationMessages) {
  const proposedTimesISO = proposedTimes.map(s => s.toISOString()).join(', ');
  const history = conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n');
  const now = new Date();

  const systemPrompt = `Você é um sistema de análise de agendamento de alta precisão em português do Brasil. Sua tarefa é analisar a resposta de um devedor a uma proposta de agendamento e retornar um objeto JSON.

### Contexto
- **Data e Hora Atuais (UTC):** ${now.toISOString()}
- **Fuso Horário:** America/Sao_Paulo
- **Horários Propostos pela IA (em UTC):** [${proposedTimesISO}]

### Formato de Saída (OBRIGATÓRIO)
{ "status": "CONFIRMED | REJECTED | NEGOTIATING | UNCLEAR", "dateTime": "ISO8601 | null" }

### Regras
1. **CONFIRMED**: Devedor aceitou um horário ou sugeriu novo horário específico → preencha dateTime em UTC.
2. **NEGOTIATING**: Rejeitou os horários e pediu novas opções → dateTime = null.
3. **REJECTED**: Recusou a reunião sem interesse → dateTime = null.
4. **UNCLEAR**: Resposta ambígua ou não relacionada → dateTime = null.`;

  const userPrompt = `### Histórico:\n${history}\n\n### JSON de Análise:`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildSchedulingParsePrompt };
