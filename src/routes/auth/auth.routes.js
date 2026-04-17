const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../../controllers/auth/auth.controller');
const auth = require('../../middleware/auth'); // Seu middleware de autenticação

// Registro
/*
router.post('/register', [
  body('name').notEmpty().withMessage('Nome é obrigatório'),
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
], authController.register);
*/

router.post('/login', [
  body('email').isEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('Senha é obrigatória'),
], authController.login);

//confirmação de email
/*
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-confirmation', authController.resendConfirmationEmail);
*/

router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

router.delete('/delete-account', auth, authController.deleteAccount);


// Rota GET /profile
router.get('/profile', auth, (req, res) => {
  // --- CONSOLE LOG ADICIONADO AQUI ---
  console.log('--- ROTA GET /profile CHAMADA ---');
  authController.getProfile(req, res); // Chama a função do controller
});

// Rota PUT /profile
router.put('/profile', auth, (req, res) => {
  // --- CONSOLE LOG ADICIONADO AQUI ---
  console.log('--- ROTA PUT /profile CHAMADA ---');
  authController.updateProfile(req, res); // Chama a função do controller
});

router.get('/theme', auth, authController.getUserTheme);
router.patch('/theme', auth, authController.updateUserTheme);

router.patch('/settings/view', auth, authController.updateConversationView);

module.exports = router;