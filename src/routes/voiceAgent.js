// Arquivo: routes/voiceAgent.js
const express = require('express');
const router = express.Router();
const voiceAgentController = require('../controllers/voiceAgentController'); 
const authMiddleware = require('../middleware/auth'); // Se necessário para startCall

// Rota para iniciar a chamada (protegida por autenticação, provavelmente)
router.post('/start-call', authMiddleware, voiceAgentController.startCall);

// Rota para o Twilio obter o TwiML inicial (GET ou POST, depende do Twilio)
router.post('/twiml', voiceAgentController.generateTwiml); // Twilio geralmente usa POST
router.get('/twiml', voiceAgentController.generateTwiml); // Adicione GET por segurança

// Rota que o <Record action="..."> chama com a gravação
router.post('/handle-recording', voiceAgentController.handleRecording);

// Rota que o TwiML chama para a IA pensar (após handleRecording)
router.post('/think', voiceAgentController.thinkAndRespond);

// Rota para servir o áudio cacheado pelo ttsService (precisa existir)
const ttsService = require('../services/textToSpeechService');
router.get('/get-audio/:audioId', ttsService.getCachedAudio); // Usado pelo <Play>

module.exports = router;