const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post(
  '/send-message',
  auth,
  [
    body('subject').notEmpty().withMessage('O assunto é obrigatório.'),
    body('message').notEmpty().withMessage('A mensagem é obrigatória.'),
  ],
  validateRequest,
  supportController.sendMessage
);

module.exports = router;
