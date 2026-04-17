const express = require('express');
const router = express.Router();
// MODIFICADO: Importamos a nova função que vamos criar no controller
const { handleLandingAIChat, handleLandingAISpeech } = require('../../controllers/ai/landing.controller');

// Esta rota continua a mesma, para receber e responder mensagens de texto
router.post('/', handleLandingAIChat);

// NOVO: Adicionamos esta rota para lidar com os pedidos de áudio
router.post('/speak', handleLandingAISpeech);

module.exports = router;