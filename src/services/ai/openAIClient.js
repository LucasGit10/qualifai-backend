// Centralizar a inicialização da API da OpenAI.
const OpenAI = require('openai');
const logger = require('../../utils/logger');

if (!process.env.OPENAI_API_KEY) {
  logger.error("OPENAI_API_KEY environment variable not set.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = openai;