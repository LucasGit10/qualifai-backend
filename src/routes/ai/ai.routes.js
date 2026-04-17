const express = require('express');
const router = express.Router();
const aiController = require('../../controllers/ai/ai.controller');
const auth = require('../../middleware/auth');
const { body, validationResult } = require('express-validator');

// Middleware de validação
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post('/conversation/start', 
  auth,
  [
    body('leadId').isMongoId().withMessage('ID do lead inválido'),
    body('channel').isIn(['email', 'whatsapp', 'chat', 'linkedin']).withMessage('Canal inválido'),
    // Valida 'instanceId' e 'templateId' APENAS se o canal for 'whatsapp'
    body('instanceId').if(body('channel').equals('whatsapp')).isMongoId().withMessage('ID da instância é obrigatório e inválido'),
    body('templateId').if(body('channel').equals('whatsapp')).isMongoId().withMessage('ID do template é obrigatório e inválido'),
  ],
  validateRequest,
  aiController.startConversation
);

router.post('/conversation/start-multiple',
  auth,
  [
    body('leadIds').isArray({ min: 1 }).withMessage('leadIds deve ser um array com pelo menos um item'),
    body('leadIds.*').isMongoId().withMessage('ID de lead inválido no array'),
    body('channel').isIn(['email', 'whatsapp', 'chat', 'linkedin']).withMessage('Canal inválido'),
    // Adiciona a mesma validação para a rota de múltiplas conversas
    body('instanceId').if(body('channel').equals('whatsapp')).isMongoId().withMessage('ID da instância é obrigatório e inválido'),
    body('templateId').if(body('channel').equals('whatsapp')).isMongoId().withMessage('ID do template é obrigatório e inválido'),
  ],
  validateRequest,
  aiController.startMultipleConversations
);

// Processar resposta do lead
router.post('/conversation/response',
  auth,
  [
    body('conversationId').isMongoId().withMessage('ID da conversa inválido'),
    body('message').isString().withMessage('Mensagem é obrigatória'),
    body('channel').isIn(['email', 'whatsapp', 'chat', 'linkedin']).withMessage('Canal inválido')
  ],
  validateRequest,
  aiController.processLeadResponse
);

// Escalar para humano
router.post('/conversation/escalate',
  auth,
  [
    body('conversationId').isMongoId().withMessage('ID da conversa inválido'),
    body('reason').optional().isString()
  ],
  validateRequest,
  aiController.escalateToHuman
);

// Gerar template de campanha
router.post('/generate-template',
  auth,
  [
    body('name').notEmpty().withMessage('O nome da campanha é obrigatório.'),
    body('description').notEmpty().withMessage('A descrição da campanha é obrigatória.'),
    body('channel').isIn(['whatsapp', 'email']).withMessage('Canal inválido.')
  ],
  validateRequest,
  aiController.generateTemplate
);
router.post('/text-to-speech-sample', aiController.getSpeechSample);

module.exports = router;