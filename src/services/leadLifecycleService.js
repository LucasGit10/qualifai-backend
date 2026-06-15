const { getModel } = require('../utils/modelProvider');
const Lead = getModel('Lead');
const User = getModel('User');
const Conversation = getModel('Conversation');
const logger = require('../utils/logger');

const INACTIVITY_PERIOD_SECONDS = 50;

class LeadLifecycleService {
  async processInactiveLeads() {
    logger.info('[CRON] Iniciando verificação de leads inativos para todos os usuários...');

    try {
      const users = await User.find({}).select('_id settings').lean();
      const userIds = users.map(user => user._id);

      let totalLeadsUpdated = 0;

      for (const user of users) {
        const userId = user._id;

        // Buscar leads que estão em follow-up ativo
        // Encontramos todas as conversas daquele usuário que têm uma próxima tentativa de follow-up agendada no futuro.
        const activeFollowUpConversations = await Conversation.find({
          user: userId,
          'followup.nextAttemptAt': { $gt: new Date() }
        }).select('lead').lean();

        // Extraímos apenas os IDs dos leads dessas conversas.
        const leadsInFollowUpIds = activeFollowUpConversations.map(conv => conv.lead);

        const inactivityThreshold = new Date();
        inactivityThreshold.setSeconds(inactivityThreshold.getSeconds() - INACTIVITY_PERIOD_SECONDS);

        const customStatuses = user.settings?.debtorStatuses || [];
        const defaultDebtorStatuses = ['em_negociacao', 'acordado', 'contatado'];
        const ignoredStatuses = ['frio', 'convertido', 'dispensou_ligacao', 'novo', ...defaultDebtorStatuses, ...customStatuses];

        // Arquivar quem já quitou
        await Lead.updateMany(
          {
            user: userId,
            status: 'quitado',
            lastContact: { $lt: inactivityThreshold }
          },
          { $set: { status: 'arquivado' } }
        );

        // Mudar status de quem não respondeu
        const result = await Lead.updateMany(
          {
            user: userId,
            status: { $nin: [...ignoredStatuses, 'quitado', 'arquivado'] },
            lastContact: { $lt: inactivityThreshold },
            _id: { $nin: leadsInFollowUpIds }
          },
          { $set: { status: 'sem_resposta' } }
        );

        if (result.modifiedCount > 0) {
          logger.info(`[CRON] Usuário ${userId}: ${result.modifiedCount} leads foram movidos para 'sem_resposta'.`);
          totalLeadsUpdated += result.modifiedCount;
        }
      }

      if (totalLeadsUpdated > 0) {
        logger.info(`[CRON] Processo concluído. Total de ${totalLeadsUpdated} leads atualizados entre todos os usuários.`);
      } else {
        logger.info('[CRON] Processo concluído. Nenhum lead inativo encontrado para nenhum usuário.');
      }

    } catch (error) {
      logger.error('[CRON] Erro geral ao processar leads inativos:', { message: error.message, stack: error.stack });
    }
  }
}

module.exports = new LeadLifecycleService();