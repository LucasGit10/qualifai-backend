// services/ai/aiAudioService.js
// Serviço de áudio Gemini (TTS para WhatsApp + STT).
// Delega para o serviço de voz mantendo a API pública idêntica.
module.exports = require('./voice/gemini-voice.service');
