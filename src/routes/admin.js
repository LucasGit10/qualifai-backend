const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { body, validationResult } = require('express-validator');

// Middleware de validação
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Aplicar autenticação e verificação de admin a todas as rotas
router.use(auth, admin);

// GET /api/admin/users - Listar todos os usuários
router.get('/users', adminController.getAllUsers);

// POST /api/admin/users - Criar novo usuário
router.post('/users', [
  body('name').notEmpty().withMessage('Nome é obrigatório'),
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
  body('role').optional().isIn(['admin', 'sales', 'manager']).withMessage('Role inválido'),
  body('plan').optional().isIn(['guest', 'basic', 'medium', 'pro']).withMessage('Plano inválido'),
], validateRequest, adminController.createUser);

// PUT /api/admin/users/:id - Atualizar um usuário
router.put('/users/:id', adminController.updateUser);

// POST /api/admin/checkout-link - Gerar link de checkout para usuário
router.post('/checkout-link', [
  body('userId').isMongoId().withMessage('ID do usuário inválido'),
  body('planId').notEmpty().withMessage('ID do plano é obrigatório'),
], validateRequest, adminController.createCheckoutLinkForUser);

// PUT /api/admin/conversations/:id - Atualizar uma conversa
router.put('/conversations/:id', adminController.updateConversationByAdmin);

module.exports = router;