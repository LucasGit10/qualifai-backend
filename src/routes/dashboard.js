const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

router.get('/stats', auth, dashboardController.getStats);
router.get('/activities', auth, dashboardController.getRecentActivities);
router.get('/campaigns/:id/stats', auth, dashboardController.getCampaignStats);

module.exports = router;