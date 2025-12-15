const express = require('express');
const router = express.Router();
const lushaController = require('../controllers/lusha.controller');
const auth = require('../middleware/auth');

router.post(
  '/prospect',auth,
  lushaController.prospectAndSave
);

module.exports = router;