const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const integrationController = require('../controllers/integrationController');

// Atualizar configurações de integração
router.put('/settings', auth, integrationController.updateSettings);

// Importar leads de todos os CRMs ativos
router.post('/import-from-all-crms', auth, integrationController.importFromAllCRMs);

// Testar integração Pipefy e buscar campos
router.post('/pipefy/test', auth, integrationController.testPipefyConnection);

// Rotas para Google Calendar OAuth
router.get('/google/auth-url', auth, integrationController.googleAuthUrl);
router.get('/google/callback', integrationController.googleCallback);
router.post('/google/disconnect', auth, integrationController.googleDisconnect);

// Rota de teste para o Google Calendar
router.get('/google/test-calendar', auth, integrationController.testGoogleCalendar);

// Rotas para Kommo OAuth
//router.get('/kommo/auth-url', auth, integrationController.kommoAuthUrl);
router.get('/kommo/callback', integrationController.kommoCallback);
router.post('/kommo/disconnect', auth, integrationController.kommoDisconnect);

// Rotas para Pipedrive OAuth
router.get('/pipedrive/auth-url', auth, integrationController.pipedriveAuthUrl);
router.get('/pipedrive/callback', integrationController.pipedriveCallback);
router.post('/pipedrive/disconnect', auth, integrationController.pipedriveDisconnect);

module.exports = router;