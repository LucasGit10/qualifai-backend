const express = require('express');
const router = express.Router();
const whatsAppAiController = require('../../controllers/conversations/whatsapp-ai.controller');
const auth = require('../../middleware/auth');
const requireComplianceDocument = require('../../middleware/requireComplianceDocument');

router.post(
  '/start',
  auth,
  requireComplianceDocument,
  whatsAppAiController.startConversationWithTemplate
);

router.post(
  '/start-batch',
  auth,
  requireComplianceDocument,
  whatsAppAiController.startMultipleConversationsWithTemplate
);

router.post(
  '/process-response',
  auth,
  requireComplianceDocument,
  whatsAppAiController.processLeadResponse
);

router.get(
  '/whatsapp-provider',
  auth,
  whatsAppAiController.getWhatsAppProvider
);

module.exports = router;