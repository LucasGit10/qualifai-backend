// Arquivo: routes/voiceAgent.js
const express = require('express');
const router = express.Router();
const voiceAgentController = require('../../controllers/ai/voice-agent.controller'); 
const authMiddleware = require('../../middleware/auth'); // Se necessário para startCall
const requireComplianceDocument = require('../../middleware/requireComplianceDocument');

// Rota para iniciar a chamada (protegida por autenticação, provavelmente)
router.post('/start-call', authMiddleware, requireComplianceDocument, voiceAgentController.startCall);

// Rota para o Twilio obter o TwiML inicial (GET ou POST, depende do Twilio)
router.post('/twiml', voiceAgentController.generateTwiml); // Twilio geralmente usa POST
router.get('/twiml', voiceAgentController.generateTwiml); // Adicione GET por segurança
// Rota que o Twilio chama para relatar mudança de status da ligação (no-answer, failed, etc)
router.post('/status', voiceAgentController.handleCallStatus);

// Rota que o <Record action="..."> chama com a gravação
router.post('/handle-recording', voiceAgentController.handleRecording);

// Rota que o TwiML chama para a IA pensar (após handleRecording)
router.post('/think', voiceAgentController.thinkAndRespond);

// Rota para servir o áudio cacheado pelo ttsService (precisa existir)
const ttsService = require('../../services/textToSpeechService');
router.get('/get-audio/:audioId', ttsService.getCachedAudio); // Usado pelo <Play>

module.exports = router;