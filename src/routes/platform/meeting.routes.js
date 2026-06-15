const express = require('express');
const router = express.Router();

const { scheduleMeeting } = require('../../controllers/platform/meeting.controller');

router.post('/schedule-meeting', scheduleMeeting);

module.exports = router;
