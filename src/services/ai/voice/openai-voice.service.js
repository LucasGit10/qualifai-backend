// voice/openai-voice.service.js
// Serviço de áudio usando OpenAI (TTS para WhatsApp + STT com Whisper).
// Substitui e centraliza aiAudioService.js.
const { textToSpeech, speechToText } = require('../handlers/audio.handler');
const logger = require('../../../utils/logger');

class OpenAiVoiceService {
  async textToSpeech(text, voice = 'nova') {
    try {
      return await textToSpeech(text, voice);
    } catch (error) {
      logger.error('Erro no OpenAI TTS:', error);
      throw new Error('Erro ao converter texto para áudio');
    }
  }

  async generateSpeechSample(voice) {
    const sampleText = 'Olá, esta é uma demonstração da minha voz. Use-a para interagir com seus devedores de uma forma mais pessoal e eficaz.';
    return this.textToSpeech(sampleText, voice);
  }

  async speechToText(audioBuffer) {
    try {
      return await speechToText(audioBuffer);
    } catch (error) {
      logger.error('Erro no OpenAI STT (Whisper):', error);
      throw new Error('Erro ao transcrever áudio');
    }
  }
}

module.exports = new OpenAiVoiceService();
