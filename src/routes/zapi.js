const express = require('express');
const router = express.Router();
const zapiController = require('../controllers/zapiController');
const auth = require('../middleware/auth');

router.use(auth);

router.post('/connect', zapiController.connect);
router.post('/disconnect', zapiController.disconnect);
router.post('/send', zapiController.sendMessage);
router.get('/status', zapiController.getStatus);


module.exports = router;