const OpenAI = require('openai');
const { aiConfig, company } = require('../config/aiConfigs/promptConfig');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildSystemPrompt() {
  return `
Você está conversando como ${aiConfig.agentName}, um atendente virtual da ${company.name}, uma empresa de ${aiConfig.companyIndustry}.

Estilo de comunicação: ${aiConfig.communicationStyle}
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

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: messages,
    temperature: 0.7,
    max_tokens: 1000,
  });

  return response.choices[0].message.content;
}

module.exports = {
  getLandingChatResponse
};