const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/auth/admin.controller');
const auth = require('../../middleware/auth');
const admin = require('../../middleware/admin');
const { body, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.use(auth, admin);

router.get('/users', adminController.getAllUsers);

router.post('/users', [
  body('name').notEmpty().withMessage('Nome é obrigatório'),
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
  body('role').optional().isIn(['admin', 'sales', 'manager']).withMessage('Role inválido'),
  body('plan').optional().isIn(['guest', 'basic', 'medium', 'pro']).withMessage('Plano inválido'),
], validateRequest, adminController.createUser);

router.put('/users/:id', adminController.updateUser);

router.post('/checkout-link', [
  body('userId').isMongoId().withMessage('ID do usuário inválido'),
  body('planId').notEmpty().withMessage('ID do plano é obrigatório'),
], validateRequest, adminController.createCheckoutLinkForUser);

router.put('/conversations/:id', adminController.updateConversationByAdmin);

module.exports = router;