const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversationController');
const auth = require('../middleware/auth');

router.get('/', auth, conversationController.getConversations);
router.get('/:id', auth, conversationController.getConversationById);
router.get('/lead/:leadId', auth, conversationController.getConversationsByLead);
router.put('/:id/status', auth, conversationController.updateConversationStatus);
router.post('/:id/notes', auth, conversationController.addNote);

// Rota genérica para atualização. Deve vir depois de rotas mais específicas.
router.put('/:id', auth, conversationController.updateConversation);
router.get('/:id/notes', auth, conversationController.getNotes);
router.delete('/delete/:id', auth, conversationController.deleteConversation);

module.exports = router;