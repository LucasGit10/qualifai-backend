const express = require('express');
const router = express.Router();
const aiController = require('../../controllers/ai/ai.controller');
const auth = require('../../middleware/auth');
const requireComplianceDocument = require('../../middleware/requireComplianceDocument');
const { body, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post('/conversation/start',
  auth,
  requireComplianceDocument,
  [
    body('leadId').isMongoId().withMessage('ID do lead invalido'),
    body('channel').isIn(['email', 'whatsapp', 'chat', 'linkedin']).withMessage('Canal invalido'),
    body('instanceId').optional().isMongoId().withMessage('ID da instancia e invalido'),
    body('templateId').optional().isMongoId().withMessage('ID do template e invalido'),
  ],
  validateRequest,
  aiController.startConversation
);

router.post('/conversation/start-multiple',
  auth,
  requireComplianceDocument,
  [
    body('leadIds').isArray({ min: 1 }).withMessage('leadIds deve ser um array com pelo menos um item'),
    body('leadIds.*').isMongoId().withMessage('ID de lead invalido no array'),
    body('channel').isIn(['email', 'whatsapp', 'chat', 'linkedin']).withMessage('Canal invalido'),
    body('instanceId').optional().isMongoId().withMessage('ID da instancia e invalido'),
    body('templateId').optional().isMongoId().withMessage('ID do template e invalido'),
  ],
  validateRequest,
  aiController.startMultipleConversations
);

router.post('/conversation/response',
  auth,
  requireComplianceDocument,
  [
    body('conversationId').isMongoId().withMessage('ID da conversa invalido'),
    body('message').isString().withMessage('Mensagem e obrigatoria'),
    body('channel').isIn(['email', 'whatsapp', 'chat', 'linkedin']).withMessage('Canal invalido')
  ],
  validateRequest,
  aiController.processLeadResponse
);

router.post('/conversation/escalate',
  auth,
  [
    body('conversationId').isMongoId().withMessage('ID da conversa invalido'),
    body('reason').optional().isString()
  ],
  validateRequest,
  aiController.escalateToHuman
);

router.post('/generate-template',
  auth,
  [
    body('name').notEmpty().withMessage('O nome da campanha e obrigatorio.'),
    body('description').notEmpty().withMessage('A descricao da campanha e obrigatoria.'),
    body('channel').isIn(['whatsapp', 'email']).withMessage('Canal invalido.')
  ],
  validateRequest,
  aiController.generateTemplate
);

router.post('/text-to-speech-sample', aiController.getSpeechSample);

module.exports = router;
