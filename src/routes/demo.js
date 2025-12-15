const express = require('express');
const router = express.Router();

const { scheduleDemo } = require('../controllers/demoController');

// Rota publica para agendar uma demonstração
router.post('/schedule-demo', scheduleDemo);

module.exports = router;