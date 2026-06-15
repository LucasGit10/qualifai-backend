const express = require('express');
const router = express.Router();
const whatsAppAiController = require('../../controllers/conversations/whatsapp-ai.controller');
const auth = require('../../middleware/auth');

router.post(
  '/start',
  auth,
  whatsAppAiController.startConversationWithTemplate
);

router.post(
  '/start-batch',
  auth,
  whatsAppAiController.startMultipleConversationsWithTemplate
);

router.post(
  '/process-response',
  auth,
  whatsAppAiController.processLeadResponse
);

router.get(
  '/whatsapp-provider',
  auth,
  whatsAppAiController.getWhatsAppProvider
);

module.exports = router;