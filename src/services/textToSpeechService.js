/**
 * textToSpeechService.js
 * * Agente especializado em converter texto para áudio (TTS).
 * Responsável por:
 * 1. Chamar a API da ElevenLabs para voz clonada.
 * 2. Gerenciar o cache de áudio para o Twilio.
 * 3. (Futuramente) Gerenciar outros fallbacks (ex: OpenAI TTS).
 */

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const axios = require('axios');
const crypto = require('crypto');

// Configuração do Cliente ElevenLabs
const elevenLabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});
const MY_VOICE_ID = 'lWq4KDY8znfkV0DrK8Vb'; // Mantido aqui

// Cache de áudio com TTL de 5 minutos (300 segundos)
// Usamos `useClones: false` para performance, já que só armazenamos Buffers.
const ttsCache = new NodeCache({ stdTTL: 300, useClones: false });

class TextToSpeechService {

  /**
   * Gera áudio de voz clonada e retorna uma URL pública (cacheada) para o TwiML.
   * Retorna `null` se a geração de áudio falhar.
   * @param {string} textToSpeak - O texto que deve ser falado.
   * @returns {Promise<string|null>} A URL do áudio cacheado ou null em caso de falha.
   */
  async generateClonedVoiceAudio(textToSpeak) {
    if (!textToSpeak || textToSpeak.trim() === '') {
      logger.warn('[TTS Service] Tentativa de falar texto vazio. Ignorando.');
      return null;
    }

    if (!MY_VOICE_ID || !process.env.ELEVENLABS_API_KEY) {
      logger.error('[TTS Service] ElevenLabs não configurado. API Key ou Voice ID ausentes.');
      return null;
    }

    // Ajustes de pronúncia
    let speakableText = textToSpeak
      .replace(/QualifAI/g, 'Qualif-Ay')
      .replace(/CRM/g, 'Cê-Erre-Eme')
      .replace(/Twilio/g, 'Tuí-lio');

    logger.info(`[TTS Service] Gerando áudio para: "${speakableText}"`);

    try {
      const response = await axios({
        method: 'POST',
        url: `https://api.elevenlabs.io/v1/text-to-speech/${MY_VOICE_ID}`,
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        data: {
          text: speakableText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8
          }
        },
        responseType: 'arraybuffer'
      });

      const audioBuffer = Buffer.from(response.data);

      // --- Cache do áudio para Twilio tocar ---
      const audioId = crypto.randomUUID();
      ttsCache.set(audioId, audioBuffer);
      const audioUrl = `${process.env.PUBLIC_URL}/api/voice-agent/get-audio/${audioId}`;

      return audioUrl; // Sucesso! Retorna a URL

    } catch (error) {
      logger.error(`[TTS Service] Erro ao gerar áudio ElevenLabs: ${error.message}`);
      if (error.response) {
        logger.error(`[TTS Service] Detalhes: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      return null; // Falha
    }
  }

  /**
   * Rota para servir o áudio cacheado para o Twilio.
   * (Controlador de rota)
   */
  async getCachedAudio(req, res) {
    const { audioId } = req.params;
    const audioBuffer = ttsCache.get(audioId);

    if (!audioBuffer) {
      logger.warn(`[TTS Service] Áudio ${audioId} expirado ou não encontrado`);
      return res.status(404).send('Audio not found or expired');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    if (audioBuffer.length) {
      res.setHeader('Content-Length', audioBuffer.length);
    }
    res.send(audioBuffer);
  }
}

module.exports = new TextToSpeechService();