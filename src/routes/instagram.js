// ARQUIVO: routes/instagramRoutes.js

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // Seu middleware de autenticação
const instagramController = require('../controllers/instagramController');

// --- ROTAS DE GERENCIAMENTO DA CONEXÃO (usadas pelo frontend) ---

// NOVO: Rota para o frontend verificar se uma conta já está conectada.
router.get('/status', auth, instagramController.getStatus);

// NOVO: Rota para o frontend conectar a conta usando o accessToken do SDK.
router.post('/connect/sdk', auth, instagramController.connectAccountWithSDK);

// NOVO: Rota para o frontend desconectar a conta.
router.delete('/disconnect', auth, instagramController.disconnectAccount);


// --- ROTAS DE WEBHOOK (usadas pela Meta) ---

// Rota para a Meta verificar a autenticidade do seu webhook.
router.get('/webhook', instagramController.verifyWebhook);

// Rota para a Meta enviar os eventos de mensagem e comentários.
router.post('/webhook', (req, res) => {
    console.log("Recebendo Webhook. Corpo da requisição:", req.body);
    instagramController.handleWebhookEvent(req, res);
});

module.exports = router;