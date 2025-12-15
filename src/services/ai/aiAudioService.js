// Lidar com todo o processamento de áudio.
const openai = require('./openAIClient');
const logger = require('../../utils/logger');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

class AiAudioService {

  async textToSpeech(text, voice = 'nova') {
    try {
      const response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: voice,
        input: text,
        response_format: 'opus',
      });
      
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (error) {
      logger.error('Erro no serviço de Text-to-Speech:', error);
      throw new Error('Erro ao converter texto para áudio');
    }
  }

  async generateSpeechSample(voice) {
    const sampleText = "Olá, esta é uma demonstração da minha voz. Use-a para interagir com seus leads de uma forma mais pessoal.";
    return this.textToSpeech(sampleText, voice);
  }

  async speechToText(audioBuffer) {
    const tempFilePath = path.join(os.tmpdir(), `qualifai-audio-${Date.now()}.mp3`);
    try {
      await fs.writeFile(tempFilePath, audioBuffer);
      const transcription = await openai.audio.transcriptions.create({
        file: require('fs').createReadStream(tempFilePath),
        model: 'whisper-1',
      });
      return transcription.text;
    } catch (error) {
      logger.error('Erro no serviço de Speech-to-Text:', error);
      throw new Error('Erro ao transcrever áudio');
    } finally {
      // O 'require' original do 'fs' aqui era síncrono, mas o unlink é assíncrono.
      // Mantendo o uso do 'fs/promises' importado no topo.
      await fs.unlink(tempFilePath).catch(err => logger.warn(`Failed to delete temp audio file: ${err.message}`));
    }
  }
}

module.exports = new AiAudioService();