const express = require('express');
const router = express.Router();

const { scheduleMeeting } = require('../controllers/meetingController');

router.post('/schedule-meeting', scheduleMeeting);

module.exports = router;
