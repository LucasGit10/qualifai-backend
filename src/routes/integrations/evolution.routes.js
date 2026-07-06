const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const evolutionController = require('../../controllers/integrations/evolution.controller');
const auth = require('../../middleware/auth');
const requireComplianceDocument = require('../../middleware/requireComplianceDocument');

// Validações
const validateCreateInstance = [
  body('phoneNumber')
    .matches(/^\(\d{2}\)\s\d{4,5}-\d{4}$/)
    .withMessage('Formato de telefone inválido. Use: (99) 99999-9999'),
  body('instanceName')
    .optional()
    .isLength({ min: 3 })
    .withMessage('Nome da instância deve ter pelo menos 3 caracteres'),
  body('forceNew')
    .optional()
    .isBoolean()
    .withMessage('forceNew deve ser boolean')
];

const validateConnectInstance = [
  body('instanceName')
    .notEmpty()
    .withMessage('Nome da instância é obrigatório'),
  body('phoneNumber')
    .optional()
    .matches(/^\(\d{2}\)\s\d{4,5}-\d{4}$/)
    .withMessage('Formato de telefone inválido')
];

const validateSendMessage = [
  body('phone').notEmpty().withMessage('Telefone é obrigatório'),
  body('message').notEmpty().withMessage('Mensagem é obrigatória')
];

// Rotas principais
router.get('/instances/available', auth, evolutionController.listAvailableInstances);
router.get('/instances', auth, evolutionController.getUserInstances);
router.delete('/instance/:instanceName/permanent', auth, evolutionController.permanentDelete);
router.get('/instance/:instanceName/sync', auth, evolutionController.syncInstanceStatus);
// Criar ou conectar instância
router.post('/instance/create', auth, validateCreateInstance, evolutionController.createOrConnectInstance);
router.post('/instance/connect', auth, validateConnectInstance, evolutionController.connectToExistingInstance);

// Gerenciar instâncias específicas
router.get('/instance/:instanceName/qrcode', auth, evolutionController.getQRCode);
router.get('/instance/:instanceName/status', auth, evolutionController.getInstanceStatus);
router.delete('/instance/:instanceName', auth, evolutionController.deleteInstance);
router.post('/instance/:instanceName/reactivate', auth, evolutionController.reactivateInstance);
router.post('/instance/:instanceName/restart', auth, evolutionController.restartInstance);
// Enviar mensagens
router.post('/instance/:instanceName/send', auth, requireComplianceDocument, validateSendMessage, evolutionController.sendMessage);
router.post('/instance/:instanceName/webhook', auth, evolutionController.updateWebhook);
module.exports = router;