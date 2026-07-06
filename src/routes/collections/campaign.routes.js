const express = require('express');
const router = express.Router();
const campaignController = require('../../controllers/collections/campaign.controller');
const auth = require('../../middleware/auth');
const requireComplianceDocument = require('../../middleware/requireComplianceDocument');

// Aplicar autenticação a todas as rotas
router.use(auth);

// Listar campanhas
router.get('/', campaignController.list);

// Criar campanha
router.post('/', campaignController.create);

// Obter campanha específica
router.get('/:id', campaignController.getById);

// Upload de contatos CSV
router.post('/:id/contacts/upload', campaignController.uploadContacts);

// Iniciar campanha
router.post('/:id/start', requireComplianceDocument, campaignController.start);

// Pausar campanha
router.post('/:id/pause', campaignController.pause);

// **NOVA ROTA** para reiniciar a campanha
router.post('/:id/restart', campaignController.restart);

// Cancelar campanha
router.post('/:id/cancel', campaignController.cancel);

// Deletar campanha permanentemente
router.delete('/:id', campaignController.delete);

// Estatísticas da campanha
router.get('/:id/stats', campaignController.getStats);

// Atualizar campanha
router.put('/:id', campaignController.update);

// Duplicar campanha
router.post('/:id/duplicate', campaignController.duplicate);

// Gerar template com IA
router.post('/ai/generate-template', campaignController.generateTemplate);

// ==========================================================
//  ✅ NOVA ROTA PARA DIAGNÓSTICO DO MM LITE
// ==========================================================
// Verifica o status de migração do WABA ID para MM Lite.
router.get('/instance/:instanceId/migration', campaignController.checkMigration);


module.exports = router;