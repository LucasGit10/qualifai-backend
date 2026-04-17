const express = require('express');
const router = express.Router();
const whatsappInstanceController = require('../../controllers/conversations/whatsapp-instance.controller');
const auth = require('../../middleware/auth');

router.get('/webhook', whatsappInstanceController.verifyWebhook);
router.post('/webhook', whatsappInstanceController.receiveWebhook);
router.use(auth);
router.get('/', whatsappInstanceController.listInstances);
router.post('/', whatsappInstanceController.createInstance);
router.delete('/instances/:id', whatsappInstanceController.deleteInstance);
router.patch('/:instanceId/token', whatsappInstanceController.updateInstanceToken);
router.post('/complete-onboarding', whatsappInstanceController.completeOnboarding);
router.post('/send', whatsappInstanceController.sendMessage);
router.get('/:instanceId/messages', whatsappInstanceController.listReceivedMessages);
router.post('/check-migration', whatsappInstanceController.checkMigrationStatus);
router.get('/media/:instanceId/:mediaId', whatsappInstanceController.getMediaContent);


module.exports = router;