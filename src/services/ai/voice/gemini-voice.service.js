const { textToSpeech, speechToText } = require('../handlers/audio.handler');
const logger = require('../../../utils/logger');

class GeminiVoiceService {
  async textToSpeech(text, voice = 'nova') {
    try {
      return await textToSpeech(text, voice);
    } catch (error) {
      logger.error('Erro no Gemini TTS:', error);
      throw new Error('Erro ao converter texto para audio');
    }
  }

  async generateSpeechSample(voice) {
    const sampleText = 'Ola, esta e uma demonstracao da minha voz. Use-a para interagir com seus devedores de uma forma mais pessoal e eficaz.';
    return this.textToSpeech(sampleText, voice);
  }

  async speechToText(audioBuffer, mimeType) {
    try {
      return await speechToText(audioBuffer, mimeType);
    } catch (error) {
      logger.error('Erro no Gemini STT:', error);
      throw new Error('Erro ao transcrever audio');
    }
  }
}

module.exports = new GeminiVoiceService();
