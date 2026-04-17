// handlers/audio.handler.js
// Wrapper da API de áudio da OpenAI (TTS e STT). Sem lógica de negócio.
const openai = require('../client');
const logger = require('../../../utils/logger');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

/**
 * Converte texto em áudio usando OpenAI TTS.
 * @param {string} text - Texto a ser convertido
 * @param {string} voice - Voz a usar ('nova', 'alloy', etc.)
 * @returns {Promise<Buffer>} Buffer de áudio em formato opus
 */
async function textToSpeech(text, voice = 'nova') {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
    response_format: 'opus',
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Transcreve áudio em texto usando OpenAI Whisper.
 * @param {Buffer} audioBuffer - Buffer de áudio
 * @returns {Promise<string>} Texto transcrito
 */
async function speechToText(audioBuffer) {
  const tempFilePath = path.join(os.tmpdir(), `qualifai-audio-${Date.now()}.mp3`);
  try {
    await fs.writeFile(tempFilePath, audioBuffer);
    const transcription = await openai.audio.transcriptions.create({
      file: require('fs').createReadStream(tempFilePath),
      model: 'whisper-1',
    });
    return transcription.text;
  } finally {
    await fs.unlink(tempFilePath).catch(err =>
      logger.warn(`Failed to delete temp audio file: ${err.message}`)
    );
  }
}

module.exports = { textToSpeech, speechToText };
