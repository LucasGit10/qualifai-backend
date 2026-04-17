// services/ai/aiAudioService.js
// Serviço de áudio OpenAI (TTS para WhatsApp + STT com Whisper).
// Delega para voice/openai-voice.service.js — mantém API pública idêntica.
module.exports = require('./voice/openai-voice.service');