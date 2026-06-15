// handlers/chat.handler.js
// Wrapper direto da API de texto do Gemini. Sem logica de negocio aqui.
const gemini = require('../geminiClient');

/**
 * Executa uma chamada de geracao no Gemini mantendo a assinatura antiga.
 * @param {Array} messages - Array de mensagens no formato {role, content}
 * @param {object} options - Opcoes extras (max_tokens, temperature, response_format, etc.)
 * @returns {Promise<string>} Conteudo da resposta (texto bruto)
 */
async function chatCompletion(messages, options = {}) {
  return gemini.chatCompletion(messages, {
    max_tokens: 300,
    temperature: 0.7,
    ...options,
  });
}

module.exports = { chatCompletion };
