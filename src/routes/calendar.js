const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');
const auth = require('../middleware/auth');

router.get('/events', auth, calendarController.getEvents);
router.post('/events', auth, calendarController.createEvent);
router.post('/events/sync', auth, calendarController.syncEvents);

module.exports = router;