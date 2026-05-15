const { aiConfig, company } = require('../config/aiConfigs/promptConfig');
const { chatCompletion } = require('./ai/handlers/chat.handler');

function buildSystemPrompt() {
  return `
Voce esta conversando como ${aiConfig.agentName}, um atendente virtual da ${company.name}, uma empresa de ${aiConfig.companyIndustry}.

Estilo de comunicacao: ${aiConfig.communicationStyle}
Idioma: ${aiConfig.language}

${aiConfig.prompt}
`;
}

async function getLandingChatResponse(userInput, conversation = []) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() }
  ];

  for (const msg of conversation) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'ai') {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  messages.push({ role: 'user', content: userInput });

  return chatCompletion(messages, {
    temperature: 0.7,
    max_tokens: 1000,
  });
}

module.exports = {
  getLandingChatResponse
};
