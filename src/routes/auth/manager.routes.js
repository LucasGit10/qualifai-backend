const express = require('express');
const router = express.Router();
const managerController = require('../../controllers/auth/manager.controller');
const auth = require('../../middleware/auth');
const manager = require('../../middleware/manager');

// Aplicar autenticação e verificação de manager a todas as rotas deste arquivo
router.use(auth, manager);

// GET /api/manager/users - Listar usuários de vendas gerenciados
router.get('/users', managerController.getManagedUsers);

// POST /api/manager/users - Criar um novo usuário de vendas
router.post('/users', managerController.createSalesUser);

// PUT /api/manager/users/:id - Atualizar um usuário de vendas
router.put('/users/:id', managerController.updateManagedUser);

// DELETE /api/manager/users/:id - Deletar um usuário de vendas
router.delete('/users/:id', managerController.deleteManagedUser);


module.exports = router;
