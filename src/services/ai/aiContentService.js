// Gerar "conteúdo de formato longo" ou tarefas de criação que não são parte de um chat em tempo real.
const openai = require('./openAIClient');
const logger = require('../../utils/logger');

class AiContentService {

  async generatePerformanceSummary(reportData) {
    if (!openai) {
        throw new Error("Serviço de IA OpenAI (ChatGPT) não inicializado. Verifique a chave de API.");
    }

    const { data, recipient, periodText } = reportData;
    const { role, channel } = recipient;

    const topSourcesText = data.topLeadSources.map(s => `${s.source} (${s.count})`).join(', ') || 'N/A';

    const prompt = `
      Você é um analista de vendas sênior. Sua tarefa é criar um resumo de performance conciso e inteligente com base nos dados fornecidos. O resumo deve ser adaptado para a audiência (${role}) e para o canal de entrega (${channel}). A língua é Português do Brasil.

      **Dados para o período (${periodText}):**
      - Leads Novos: ${data.newLeads}
      - Reuniões Agendadas: ${data.meetingsScheduled}
      - Oportunidades Criadas (Leads Qualificados): ${data.opportunitiesCreated}
      - Principais Fontes de Leads: ${topSourcesText}
      - Taxa de Resposta (estimada): ${data.cadenceResponseRate}%
      - Tempo Médio de Resposta (estimado): ${data.avgSdrResponseTime}

      **Instruções:**
      1.  **Analise os dados:** Identifique os pontos mais importantes.
      2.  **Gere Insights de IA:** Crie 2-3 insights curtos que agreguem valor. Compare dados ou identifique tendências. Ex: "Segundas-feiras estão gerando 30% mais leads que a média."
      3.  **Forneça Recomendações:** Dê 2-3 recomendações acionáveis para o próximo período.
      4.  **Adapte o Tom:**
          -   Para **'manager'**: Foco em dados operacionais, performance da equipe e sugestões táticas.
          -   Para **'c-level'**: Foco em insights estratégicos, impacto no negócio (pipeline, crescimento) e recomendações de alto nível.
      5.  **Formate a Saída:**
          -   **Para 'email'**: Gere um HTML e css com design limpo e profissional. Use emojis relevantes no início de cada título de seção. Use <h2> para seções, <p> para texto, <ul><li> para listas e <hr> para divisórias. NÃO inclua <html>, <head> ou <body> tags.
          -   **Para 'whatsapp'**: Gere um texto estruturado para leitura rápida. Use emojis relevantes para cada seção. Use negrito (*texto*) para títulos. Seja extremamente conciso.

      Comece o resumo agora.
    `;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            max_tokens: 400,
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        logger.error('Erro ao gerar resumo de performance com OpenAI:', error);
        throw new Error('Falha ao gerar resumo com a IA.');
    }
  }

  async generateCampaignTemplate({ name, description, channel }) {
    try {
      const prompt = `Você é um especialista em marketing digital focado em criar mensagens de prospecção com alta taxa de conversão.
Crie um template de mensagem para a seguinte campanha:
*Nome da Campanha:* ${name}
*Descrição da Campanha:* ${description}
*Canal de Envio:* ${channel}
*Instruções Cruciais:*
- A mensagem deve ser persuasiva e estritamente profissional.
- Adapte o tom para o canal. WhatsApp: mais direto. E-mail: mais estruturado.
- *OBRIGATÓRIO* incluir variáveis de personalização como {nome} e {empresa}.
- Responda *APENAS* com o texto do template da mensagem, sem nenhuma introdução ou comentários.
- *REGRA DE SEGURANÇA:* Não gere conteúdo que seja inapropriado, ofensivo, ou que não esteja relacionado a uma prospecção de vendas profissional.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      });
      
      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Erro ao gerar template de campanha com IA (OpenAI):', error);
      throw new Error('Erro ao gerar template com IA');
    }
  }
}

module.exports = new AiContentService();