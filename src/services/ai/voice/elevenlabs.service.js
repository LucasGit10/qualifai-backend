// voice/elevenlabs.service.js
// Serviço de TTS via ElevenLabs + cache de áudio para Twilio.
// Migrado de textToSpeechService.js — mantém API pública idêntica.
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const NodeCache = require('node-cache');
const logger = require('../../../utils/logger');
const axios = require('axios');
const crypto = require('crypto');

const elevenLabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const MY_VOICE_ID = 'lWq4KDY8znfkV0DrK8Vb';
const ttsCache = new NodeCache({ stdTTL: 300, useClones: false });

class ElevenLabsService {
  /**
   * Gera áudio de voz clonada e retorna URL pública cacheada para o TwiML.
   * @param {string} textToSpeak - Texto a ser falado
   * @returns {Promise<string|null>} URL do áudio ou null em falha
   */
  async generateClonedVoiceAudio(textToSpeak) {
    if (!textToSpeak?.trim()) {
      logger.warn('[ElevenLabs] Tentativa de falar texto vazio. Ignorando.');
      return null;
    }

    if (!MY_VOICE_ID || !process.env.ELEVENLABS_API_KEY) {
      logger.error('[ElevenLabs] API Key ou Voice ID ausentes.');
      return null;
    }

    // Ajustes de pronúncia para português
    const speakableText = textToSpeak
      .replace(/QualifAI/g, 'Qualif-Ay')
      .replace(/CRM/g, 'Cê-Erre-Eme')
      .replace(/Twilio/g, 'Tuí-lio');

    try {
      const response = await axios({
        method: 'POST',
        url: `https://api.elevenlabs.io/v1/text-to-speech/${MY_VOICE_ID}`,
        headers: {
          Accept: 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        data: {
          text: speakableText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        },
        responseType: 'arraybuffer',
      });

      const audioId = crypto.randomUUID();
      ttsCache.set(audioId, Buffer.from(response.data));
      return `${process.env.PUBLIC_URL}/api/voice-agent/get-audio/${audioId}`;
    } catch (error) {
      logger.error(`[ElevenLabs] Erro ao gerar áudio: ${error.message}`);
      return null;
    }
  }

  /**
   * Serve áudio cacheado para o Twilio.
   */
  getCachedAudio(req, res) {
    const { audioId } = req.params;
    const audioBuffer = ttsCache.get(audioId);

    if (!audioBuffer) {
      logger.warn(`[ElevenLabs] Áudio ${audioId} expirado ou não encontrado`);
      return res.status(404).send('Audio not found or expired');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    if (audioBuffer.length) res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  }
}

module.exports = new ElevenLabsService();
