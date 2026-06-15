
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const performanceReportController = require('../../controllers/platform/performance-report.controller');

router.post('/trigger-manual', auth, performanceReportController.triggerManualReport);

module.exports = router;
