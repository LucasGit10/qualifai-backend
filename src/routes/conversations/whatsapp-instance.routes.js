const express = require('express');
const router = express.Router();
const whatsappInstanceController = require('../../controllers/conversations/whatsapp-instance.controller');
const auth = require('../../middleware/auth');
const multer = require('multer');

// Configura o multer para armazenar o arquivo em memória
const upload = multer({ storage: multer.memoryStorage() });

router.get('/webhook', whatsappInstanceController.verifyWebhook);
router.post('/webhook', whatsappInstanceController.receiveWebhook);
router.use(auth);
router.get('/', whatsappInstanceController.listInstances);
router.post('/', whatsappInstanceController.createInstance);
router.delete('/instances/:id', whatsappInstanceController.deleteInstance);
router.patch('/:instanceId/token', whatsappInstanceController.updateInstanceToken);
router.post('/:instanceId/subscribe-webhook', whatsappInstanceController.subscribeInstanceWebhook);
router.post('/complete-onboarding', whatsappInstanceController.completeOnboarding);
router.post('/send', whatsappInstanceController.sendMessage);
router.post('/send-document', upload.single('file'), whatsappInstanceController.sendDocument);
router.get('/:instanceId/messages', whatsappInstanceController.listReceivedMessages);
router.post('/check-migration', whatsappInstanceController.checkMigrationStatus);
router.get('/media/:instanceId/:mediaId', whatsappInstanceController.getMediaContent);


module.exports = router;
