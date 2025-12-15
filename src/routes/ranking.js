const express = require('express');
const router = express.Router();
const rankingController = require('../controllers/rankingController');
const auth = require('../middleware/auth');

// GET /api/ranking/ - Obter o ranking de vendas para a equipe do usuário logado
router.get('/', auth, rankingController.getSalesRanking);

module.exports = router;
