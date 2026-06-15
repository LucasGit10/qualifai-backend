const TeamMember = require('../../models/TeamMember');
const plansConfig = require('../../config/plans');
const logger = require('../../utils/logger');

const findPlanByLevel = (planLevel) => {
  const planEntry = Object.entries(plansConfig).find(
    ([_key, value]) => value.associatedPlan === planLevel
  );
  return planEntry ? planEntry[1] : null;
};

class ManagerController {
  async getManagedUsers(req, res) {
    try {
      const currentUser = req.user;

      if (currentUser.role === 'admin') {
        const users = await TeamMember.find()
          .populate('owner', 'name email')
          .sort({ name: 1 });

        return res.json({
          users,
          limit: Infinity,
          currentCount: users.length,
          isAdminView: true,
        });
      }

      const planDetails = findPlanByLevel(currentUser.plan);
      const limit = planDetails ? planDetails.salesTeamLimit : 0;
      const users = await TeamMember.find({ owner: currentUser._id }).sort({ name: 1 });

      res.json({
        users,
        limit,
        currentCount: users.length,
        isAdminView: false,
      });
    } catch (error) {
      logger.error('Erro ao listar perfis de atendimento:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async createSalesUser(req, res) {
    try {
      const manager = req.user;

      if (manager.role === 'admin') {
        return res.status(403).json({ message: 'Administradores devem gerenciar contas pelo Painel Admin principal.' });
      }

      const { name, roleLabel } = req.body;
      const planDetails = findPlanByLevel(manager.plan);
      const limit = planDetails ? planDetails.salesTeamLimit : 0;
      const currentCount = await TeamMember.countDocuments({ owner: manager._id });

      if (currentCount >= limit) {
        return res.status(403).json({ message: `Voce atingiu o limite de ${limit} perfis de atendimento para o seu plano.` });
      }

      if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'Nome e obrigatorio.' });
      }

      const teamMember = new TeamMember({
        owner: manager._id,
        name: String(name).trim(),
        roleLabel: roleLabel ? String(roleLabel).trim() : 'Atendente',
        isActive: true,
      });

      await teamMember.save();
      res.status(201).json(teamMember);
    } catch (error) {
      logger.error('Erro ao criar perfil de atendimento:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Ja existe um perfil com este nome.' });
      }
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async updateManagedUser(req, res) {
    try {
      const manager = req.user;

      if (manager.role === 'admin') {
        return res.status(403).json({ message: 'Administradores devem gerenciar contas pelo Painel Admin principal.' });
      }

      const { id } = req.params;
      const { name, roleLabel, isActive } = req.body;
      const teamMember = await TeamMember.findOne({ _id: id, owner: manager._id });

      if (!teamMember) {
        return res.status(404).json({ message: 'Perfil de atendimento nao encontrado ou nao pertence a sua equipe.' });
      }

      if (name !== undefined) teamMember.name = String(name).trim();
      if (roleLabel !== undefined) teamMember.roleLabel = String(roleLabel).trim() || 'Atendente';
      if (isActive !== undefined) teamMember.isActive = isActive;

      await teamMember.save();
      res.json(teamMember);
    } catch (error) {
      logger.error('Erro ao atualizar perfil de atendimento:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Ja existe um perfil com este nome.' });
      }
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async deleteManagedUser(req, res) {
    try {
      const manager = req.user;

      if (manager.role === 'admin') {
        return res.status(403).json({ message: 'Administradores devem gerenciar contas pelo Painel Admin principal.' });
      }

      const { id } = req.params;
      const result = await TeamMember.deleteOne({ _id: id, owner: manager._id });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: 'Perfil de atendimento nao encontrado ou nao pertence a sua equipe.' });
      }

      res.json({ success: true, message: 'Perfil de atendimento excluido com sucesso.' });
    } catch (error) {
      logger.error('Erro ao deletar perfil de atendimento:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new ManagerController();
