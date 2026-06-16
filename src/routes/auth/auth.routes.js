const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../../controllers/auth/auth.controller');
const auth = require('../../middleware/auth');

router.post('/register', [
  body('name').notEmpty().withMessage('Nome e obrigatorio'),
  body('email').isEmail().withMessage('Email invalido'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
], authController.register);

router.post('/login', [
  body('email').isEmail().withMessage('Email invalido'),
  body('password').notEmpty().withMessage('Senha e obrigatoria'),
], authController.login);

router.get('/verify-email', authController.verifyEmail);
router.post('/resend-confirmation', authController.resendConfirmationEmail);

router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

router.delete('/delete-account', auth, authController.deleteAccount);

router.get('/profile', auth, (req, res) => {
  console.log('--- ROTA GET /profile CHAMADA ---');
  authController.getProfile(req, res);
});

router.put('/profile', auth, (req, res) => {
  console.log('--- ROTA PUT /profile CHAMADA ---');
  authController.updateProfile(req, res);
});

router.get('/theme', auth, authController.getUserTheme);
router.patch('/theme', auth, authController.updateUserTheme);

router.patch('/settings/view', auth, authController.updateConversationView);

module.exports = router;
