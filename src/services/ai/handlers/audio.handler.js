// handlers/audio.handler.js
// Wrapper de audio do Gemini (TTS + STT). Sem logica de negocio.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const gemini = require('../geminiClient');
const logger = require('../../../utils/logger');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const VOICE_MAP = {
  alloy: 'Kore',
  echo: 'Puck',
  fable: 'Aoede',
  onyx: 'Charon',
  nova: 'Kore',
  shimmer: 'Leda',
};

function parsePcmRate(mimeType = '') {
  const match = String(mimeType).match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

async function convertPcmToOggOpus(pcmBuffer, sampleRate = 24000) {
  const basePath = path.join(os.tmpdir(), `qualifai-gemini-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const pcmPath = `${basePath}.pcm`;
  const oggPath = `${basePath}.ogg`;

  try {
    await fs.writeFile(pcmPath, pcmBuffer);
    await new Promise((resolve, reject) => {
      ffmpeg(pcmPath)
        .inputFormat('s16le')
        .audioFrequency(sampleRate)
        .audioChannels(1)
        .audioCodec('libopus')
        .format('ogg')
        .on('end', resolve)
        .on('error', reject)
        .save(oggPath);
    });
    return await fs.readFile(oggPath);
  } finally {
    await Promise.all([
      fs.unlink(pcmPath).catch(() => {}),
      fs.unlink(oggPath).catch(() => {}),
    ]);
  }
}

/**
 * Converte texto em audio usando Gemini TTS.
 * @param {string} text - Texto a ser convertido
 * @param {string} voice - Voz legada configurada no produto
 * @returns {Promise<Buffer>} Buffer de audio em OGG/Opus
 */
async function textToSpeech(text, voice = 'nova') {
  const geminiVoice = VOICE_MAP[voice] || voice || 'Kore';
  const { buffer, mimeType } = await gemini.textToSpeechPcm(text, geminiVoice);
  return convertPcmToOggOpus(buffer, parsePcmRate(mimeType));
}

/**
 * Transcreve audio em texto usando Gemini multimodal.
 * @param {Buffer} audioBuffer - Buffer de audio
 * @param {string} mimeType - MIME do audio recebido
 * @returns {Promise<string>} Texto transcrito
 */
async function speechToText(audioBuffer, mimeType = 'audio/ogg') {
  const transcription = await gemini.transcribeAudio(audioBuffer, mimeType);
  if (!transcription) {
    logger.warn('Gemini STT retornou transcricao vazia.');
  }
  return transcription;
}

module.exports = { textToSpeech, speechToText };
