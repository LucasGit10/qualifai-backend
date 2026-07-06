const express = require('express');
const router = express.Router();
const zapiController = require('../../controllers/conversations/zapi.controller');
const auth = require('../../middleware/auth');
const requireComplianceDocument = require('../../middleware/requireComplianceDocument');

router.use(auth);

router.post('/connect', zapiController.connect);
router.post('/disconnect', zapiController.disconnect);
router.post('/send', requireComplianceDocument, zapiController.sendMessage);
router.get('/status', zapiController.getStatus);


module.exports = router;