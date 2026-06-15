const express = require('express');
const router = express.Router();

const { scheduleDemo } = require('../../controllers/billing/demo.controller');

// Rota publica para agendar uma demonstração
router.post('/schedule-demo', scheduleDemo);

module.exports = router;