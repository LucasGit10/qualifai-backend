const User = require('../../models/User');
const plansConfig = require('../../config/plans');
const logger = require('../../utils/logger');

// Helper to find plan details by associatedPlan name (e.g., 'basic')
const findPlanByLevel = (planLevel) => {
    // This is a simple lookup. In a real scenario, you might have a more direct mapping.
    const planEntry = Object.entries(plansConfig).find(
        ([_key, value]) => value.associatedPlan === planLevel
    );
    return planEntry ? planEntry[1] : null;
};

class ManagerController {

    // Listar todos os usuários de vendas gerenciados pelo manager logado
    async getManagedUsers(req, res) {
        try {
            const currentUser = req.user;

            if (currentUser.role === 'admin') {
                // Admin view: shows all managers and sales users
                const users = await User.find({ role: { $in: ['manager', 'sales'] } })
                    .select('-password')
                    .populate('managedBy', 'name email') // Populate the manager's name
                    .sort({ role: 1, name: 1 }); // Sort by role then name

                return res.json({
                    users: users,
                    limit: Infinity, // Admin has no user limit
                    currentCount: users.length,
                    isAdminView: true, // Flag for the frontend
                });
            }
            
            // Manager view (original logic)
            const managerId = currentUser._id;
            const salesUsers = await User.find({ managedBy: managerId }).select('-password');
            const planDetails = findPlanByLevel(currentUser.plan);
            const limit = planDetails ? planDetails.salesTeamLimit : 0;

            res.json({
                users: salesUsers,
                limit: limit,
                currentCount: salesUsers.length,
                isAdminView: false,
            });

        } catch (error) {
            logger.error('Erro ao listar usuários gerenciados:', error);
            res.status(500).json({ message: 'Erro interno do servidor' });
        }
    }

    // Criar um novo usuário de vendas
    async createSalesUser(req, res) {
        try {
            const manager = req.user;

            if (manager.role === 'admin') {
                return res.status(403).json({ message: 'Administradores devem criar usuários através do Painel Admin principal.' });
            }

            const { name, email, password } = req.body;

            // 1. Verificar o limite do plano
            const planDetails = findPlanByLevel(manager.plan);
            const limit = planDetails ? planDetails.salesTeamLimit : 0;
            const currentCount = await User.countDocuments({ managedBy: manager._id });

            if (currentCount >= limit) {
                return res.status(403).json({ message: `Você atingiu o limite de ${limit} usuários de vendas para o seu plano.` });
            }

            // 2. Validações básicas
            if (!name || !email || !password) {
                return res.status(400).json({ message: 'Nome, email e senha são obrigatórios.' });
            }
            if (password.length < 6) {
                return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' });
            }
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ message: 'Um usuário com este email já existe.' });
            }

            // 3. Criar o usuário
            const salesUser = new User({
                name,
                email,
                password,
                role: 'sales',
                plan: manager.plan, // Herda o plano do manager
                managedBy: manager._id,
                emailVerified: true, // Manager cria contas já verificadas
                isActive: true,
                company: manager.company, // Herda a empresa do manager
            });

            await salesUser.save();

            const userResponse = salesUser.toObject();
            delete userResponse.password;

            res.status(201).json(userResponse);

        } catch (error) {
            logger.error('Erro ao criar usuário de vendas:', error);
            res.status(500).json({ message: 'Erro interno do servidor' });
        }
    }

    // Atualizar um usuário de vendas
    async updateManagedUser(req, res) {
        try {
            const manager = req.user;

            if (manager.role === 'admin') {
                return res.status(403).json({ message: 'Administradores devem gerenciar usuários através do Painel Admin principal.' });
            }

            const managerId = manager._id;
            const { id: salesUserId } = req.params;
            const { name, isActive } = req.body;

            const salesUser = await User.findOne({ _id: salesUserId, managedBy: managerId });

            if (!salesUser) {
                return res.status(404).json({ message: 'Usuário de vendas não encontrado ou não pertence à sua equipe.' });
            }

            if (name !== undefined) salesUser.name = name;
            if (isActive !== undefined) salesUser.isActive = isActive;

            await salesUser.save();
            
            const userResponse = salesUser.toObject();
            delete userResponse.password;

            res.json(userResponse);
        } catch (error) {
            logger.error('Erro ao atualizar usuário de vendas:', error);
            res.status(500).json({ message: 'Erro interno do servidor' });
        }
    }
    
    // Deletar um usuário de vendas
    async deleteManagedUser(req, res) {
        try {
            const manager = req.user;

            if (manager.role === 'admin') {
                return res.status(403).json({ message: 'Administradores devem gerenciar usuários através do Painel Admin principal.' });
            }

            const managerId = manager._id;
            const { id: salesUserId } = req.params;

            const result = await User.deleteOne({ _id: salesUserId, managedBy: managerId });

            if (result.deletedCount === 0) {
                return res.status(404).json({ message: 'Usuário de vendas não encontrado ou não pertence à sua equipe.' });
            }

            res.json({ success: true, message: 'Usuário de vendas excluído com sucesso.' });

        } catch (error) {
            logger.error('Erro ao deletar usuário de vendas:', error);
            res.status(500).json({ message: 'Erro interno do servidor' });
        }
    }
}

module.exports = new ManagerController();