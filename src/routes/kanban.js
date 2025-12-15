const express = require('express');
const router = express.Router();
const KanbanController = require('../controllers/kanbanController');
const auth = require('../middleware/auth');

// Board routes
router.post('/boards', auth, KanbanController.createBoard);
router.get('/boards/:id', auth, KanbanController.getBoard);

// Column routes
router.post('/columns', auth, KanbanController.createColumn);
router.get('/columns/:boardId', auth, KanbanController.getColumns);
router.put('/columns/:id', auth, KanbanController.updateColumn);
router.delete('/columns/:id', auth, KanbanController.deleteColumn);

// Card routes
router.post('/cards', auth, KanbanController.createCard);
router.get('/cards/:id', auth, KanbanController.getCard);
router.put('/cards/:id', auth, KanbanController.updateCard);
router.put('/cards/:id/move', auth, KanbanController.moveCard);
router.delete('/cards/:id', auth, KanbanController.deleteCard);

// Initial data
router.get('/init', auth, KanbanController.getInitialData);

module.exports = router;