const express = require('express');
const router = express.Router();
const messageTemplateController = require('../../controllers/conversations/message-template.controller');
const auth = require('../../middleware/auth');
const upload = require('../../config/multerUpload'); // Importa sua config do Multer

router.use(auth);

// ROTA NOVA ADICIONADA
router.post(
  '/upload-sample',
  upload.single('sampleImage'),
  messageTemplateController.uploadSampleImage
);

router.get('/', messageTemplateController.list);
router.post('/', messageTemplateController.create);
router.put('/:templateId', messageTemplateController.update);

router.post(
  '/:templateId/submit',
  messageTemplateController.submitForApproval
);

router.post(
  '/:templateId/resubmit',
  messageTemplateController.resubmit
);

router.delete('/:templateId', messageTemplateController.delete);
router.get(
  '/instance/:instanceId',
  messageTemplateController.listByInstance
);

// ROTAS MM LITE
router.post('/send-mmlite', messageTemplateController.sendMMLiteCampaign);
router.get('/campaign/:campaignId/stats', messageTemplateController.getCampaignStats);

module.exports = router;