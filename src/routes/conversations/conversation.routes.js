const express = require('express');
const router = express.Router();
const conversationController = require('../../controllers/conversations/conversation.controller');
const auth = require('../../middleware/auth');

router.get('/', auth, conversationController.getConversations);
router.post('/actions/assign-legacy-to-master', auth, conversationController.assignLegacyToMaster);
router.get('/lead/:leadId', auth, conversationController.getConversationsByLead);
router.get('/:id', auth, conversationController.getConversationById);
router.put('/:id/status', auth, conversationController.updateConversationStatus);
router.put('/:id/read', auth, conversationController.markAsRead);
router.post('/:id/notes', auth, conversationController.addNote);
router.post('/:id/negotiation-intelligence', auth, conversationController.analyzeNegotiation);

// Rota genérica para atualização. Deve vir depois de rotas mais específicas.
router.put('/:id', auth, conversationController.updateConversation);
router.get('/:id/notes', auth, conversationController.getNotes);
router.delete('/delete/:id', auth, conversationController.deleteConversation);

module.exports = router;
