const User = require('../../models/User');
const Conversation = require('../../models/Conversation');
const logger = require('../../utils/logger');
const stripeService = require('../../services/stripeService');
const plans = require('../../config/plans');

class AdminController {
  // Listar todos os usuários
  async getAllUsers(req, res) {
    try {
      const users = await User.find().select('-password').sort('-createdAt');
      res.json(users);
    } catch (error) {
      logger.error('Erro ao listar usuários:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Atualizar um usuário
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Prevent sensitive fields from being updated directly by an admin.
      // These should be managed by specific routes or services (e.g., payment webhooks, password reset).
      delete updates.password;
      delete updates._id;
      delete updates.mercadoPago;
      delete updates.taxId;
      delete updates.createdAt;
      delete updates.updatedAt;

      // Prevent an admin from deactivating or demoting themselves.
      if (req.user && id === req.user._id.toString()) {
        if ((updates.role && updates.role !== 'admin') || (updates.isActive !== undefined && !updates.isActive)) {
          return res.status(400).json({ message: 'Não é possível rebaixar ou desativar a própria conta de administrador.' });
        }
      }
      
      const user = await User.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      res.json(user);
    } catch (error) {
      logger.error('Erro ao atualizar usuário:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Criar um novo usuário (admin only)
  async createUser(req, res) {
    try {
      const { name, email, password, company, role = 'sales', plan = 'guest' } = req.body;

      // Validações básicas
      if (!name || !email || !password) {
        return res.status(400).json({ message: 'Nome, email e senha são obrigatórios.' });
      }

      // Validação rigorosa de senha com regex
      const passwordValidation = {
        length: password.length >= 8,
        lowercase: /[a-z]/.test(password),
        uppercase: /[A-Z]/.test(password),
        number: /\d/.test(password),
        specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password)
      };

      const failedValidations = [];
      if (!passwordValidation.length) failedValidations.push('mínimo 8 caracteres');
      if (!passwordValidation.lowercase) failedValidations.push('uma letra minúscula');
      if (!passwordValidation.uppercase) failedValidations.push('uma letra maiúscula');
      if (!passwordValidation.number) failedValidations.push('um número');
      if (!passwordValidation.specialChar) failedValidations.push('um caractere especial (!@#$%^&*(),.?":{}|<>)');

      if (failedValidations.length > 0) {
        return res.status(400).json({ 
          message: `A senha deve conter: ${failedValidations.join(', ')}.`,
          validationErrors: passwordValidation
        });
      }

      // Validação de email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Formato de email inválido.' });
      }

      // Verificar se o email já existe
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Usuário com este email já existe.' });
      }

      // Validar role
      const validRoles = ['admin', 'sales', 'manager'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: 'Função inválida.' });
      }

      // Validar plan
      const validPlans = ['guest', 'basic', 'medium', 'pro'];
      if (!validPlans.includes(plan)) {
        return res.status(400).json({ message: 'Plano inválido.' });
      }

      // Criar o usuário
      const user = new User({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password,
        company: company ? { name: company.trim() } : undefined,
        role,
        plan,
        emailVerified: true, // Admin pode criar contas já verificadas
        isActive: true // Ativar por padrão
      });

      await user.save();

      const userResponse = user.toObject();
      delete userResponse.password;

      logger.info(`Admin ${req.user.email} criou usuário: ${user.email} com role: ${role} e plano: ${plan}`);
      res.status(201).json({ 
        success: true, 
        message: 'Usuário criado com sucesso.',
        user: userResponse 
      });

    } catch (error) {
      logger.error('Erro ao criar usuário (admin):', error);
      
      // Tratar erros específicos do MongoDB
      if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => ({
          path: err.path,
          msg: err.message
        }));
        return res.status(400).json({ 
          message: 'Dados inválidos.',
          errors 
        });
      }
      
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Email já está em uso.' });
      }
      
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Gerar link de checkout do Stripe para um usuário específico
  async createCheckoutLinkForUser(req, res) {
    try {
      const { userId, planId } = req.body;

      if (!userId || !planId) {
        return res.status(400).json({ message: 'userId e planId são obrigatórios.' });
      }

      if (!plans[planId]) {
        return res.status(400).json({ message: 'Plano inválido.' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      const session = await stripeService.createCheckoutSession(user, planId);

      logger.info(`Admin ${req.user.email} gerou link de checkout para usuário ${user.email} - plano: ${planId}`);
      
      res.json({ 
        success: true, 
        checkoutUrl: session.url,
        message: `Link de checkout criado para ${user.email}` 
      });

    } catch (error) {
      logger.error('Erro ao criar link de checkout (admin):', error);
      res.status(500).json({ 
        message: error.message || 'Erro interno do servidor ao criar link de checkout.' 
      });
    }
  }

  // Update a conversation as an admin
  async updateConversationByAdmin(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Fields that an admin is allowed to update
      const allowedUpdates = ['status', 'aiEnabled', 'handedOffToHuman'];
      const finalUpdates = {};

      for (const key of allowedUpdates) {
        if (updates[key] !== undefined) {
          finalUpdates[key] = updates[key];
        }
      }
      
      if (Object.keys(finalUpdates).length === 0) {
        return res.status(400).json({ message: 'Nenhuma atualização válida fornecida.' });
      }

      // Automatically disable AI if status is set to 'escalated'
      if (finalUpdates.status === 'escalated') {
        finalUpdates.aiEnabled = false;
        finalUpdates.handedOffToHuman = true;
      }

      const conversation = await Conversation.findByIdAndUpdate(
        id,
        { $set: finalUpdates },
        { new: true, runValidators: true }
      ).populate('lead', 'name email company phone position');

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada.' });
      }

      // Emit an event so the user's UI updates if they are viewing it
      if (conversation.user) {
        req.app.get('io').to(`user-${conversation.user.toString()}`).emit('conversation_updated', { conversation });
      }

      res.json(conversation);
    } catch (error) {
      logger.error('Erro ao atualizar conversa pelo admin:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new AdminController();