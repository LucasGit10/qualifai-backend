// handlers/chat.handler.js
// Wrapper direto da API de chat da OpenAI. Sem lógica de negócio aqui.
const openai = require('../client');
const logger = require('../../../utils/logger');

/**
 * Executa uma chamada de chat completion na OpenAI.
 * @param {Array} messages - Array de mensagens no formato {role, content}
 * @param {object} options - Opções extras (max_tokens, temperature, response_format, etc.)
 * @returns {Promise<string>} Conteúdo da resposta (texto bruto)
 */
async function chatCompletion(messages, options = {}) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 150,
    temperature: 0.7,
    ...options,
  });
  return response.choices[0].message.content.trim();
}

module.exports = { chatCompletion };
