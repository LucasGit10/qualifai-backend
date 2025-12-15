const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const leadController = require('../controllers/leadController');
const auth = require('../middleware/auth');
const Lead = require('../models/Lead');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Validações
const validateLead = [
  body('name').notEmpty().withMessage('Nome é obrigatório'),
  body('email').isEmail().withMessage('Email inválido'),
  body('company').notEmpty().withMessage('Empresa é obrigatória'),
  body('source').isIn(['form', 'linkedin', 'email', 'whatsapp', 'chat', 'paid_traffic']).withMessage('Origem inválida'),
];

// Rota genérica para sincronização
const createSyncRoute = (platform) => {
  return async (req, res) => {
    try {
      const lead = await Lead.findOne({ _id: req.params.id, user: req.user.id });
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado' });
      
      const user = await User.findById(req.user.id);
      const syncMethodName = `syncWith${platform.charAt(0).toUpperCase() + platform.slice(1)}`;
      
      await lead[syncMethodName](user.settings);

      res.json({
        success: true,
        message: `Lead sincronizado com ${platform}`,
        syncData: lead[platform.toLowerCase()]
      });
    } catch (error) {
      res.status(500).json({ 
        message: `Erro ao sincronizar com ${platform}`,
        error: error.message 
      });
    }
  };
};

// Rotas principais
router.post('/import', auth, leadController.importLeads);
router.post('/import-file', auth, upload.single('leadFile'), leadController.importLeadsFromFile);
router.post('/sync-all', auth, leadController.syncAllLeads);
router.post('/delete-multiple', auth, leadController.deleteMultipleLeads);
router.get('/', auth, leadController.getLeads);
router.get('/list', auth, leadController.getLeadList);
router.post('/', auth, validateLead, leadController.createLead);
router.get('/statuses', auth, leadController.getLeadStatuses);
router.get('/:id', auth, leadController.getLeadById);
router.put('/:id', auth, leadController.updateLead);
router.delete('/:id', auth, leadController.deleteLead);

// Rota de envio de email
router.post('/:id/send-email', auth, leadController.sendEmail);

// Rotas de sincronização
router.post('/:id/sync-hubspot', auth, createSyncRoute('HubSpot'));
router.post('/:id/sync-pipedrive', auth, createSyncRoute('Pipedrive'));
router.post('/:id/sync-salesforce', auth, createSyncRoute('Salesforce'));
router.post('/:id/sync-rdstation', auth, createSyncRoute('RDStation'));
router.post('/:id/sync-pipefy', auth, createSyncRoute('Pipefy'));
router.post('/:id/sync-zoho', auth, createSyncRoute('Zoho'));
router.post('/:id/sync-kommo', auth, createSyncRoute('Kommo'));

module.exports = router;