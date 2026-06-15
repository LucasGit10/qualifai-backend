const { getModel } = require('../../utils/modelProvider');
const Lead = getModel('Lead');
const Conversation = getModel('Conversation');
const Campaign = getModel('Campaign');
const Debt = getModel('Debt');
const Installment = getModel('Installment');
const InadimplenciaDetalhe = getModel('InadimplenciaDetalhe');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

class DashboardController {
  // Estatísticas do dashboard
  async getStats(req, res) {
    try {
      const userId = new mongoose.Types.ObjectId(req.user.id);
      logger.info(`Fetching dashboard stats for user: ${req.user.email} (${userId})`);
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      // Total de leads (all-time) for the card
      // Total de leads (ativos na base)
      const activeStatusFilter = { $nin: ['arquivado', 'sem_resposta', 'frio'] };
      
      const totalLeads = await Lead.countDocuments({ 
        user: userId,
        status: activeStatusFilter
      });

      // Leads from this month (for conversion rate calculation)
      const leadsThisMonth = await Lead.countDocuments({
        user: userId,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
      });
      
      // Escalated conversations this month
      const escalatedConversations = await Conversation.countDocuments({
        user: userId,
        status: 'escalated',
        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
      });

      // Conversas ativas
      const activeConversations = await Conversation.countDocuments({
        user: userId,
        status: 'active'
      });

      // Leads qualificados (este mês)
      const qualifiedLeads = await Lead.countDocuments({
        user: userId,
        status: 'qualificado',
        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
      });

      // Qualified leads count is still useful for other parts, so we keep it,
      // but conversionRate will be redefined below based on financial data.

      // Leads por status (apenas ativos)
      const leadsByStatus = await Lead.aggregate([
        { 
          $match: { 
            user: userId, 
            status: { $nin: ['arquivado', 'sem_resposta'] },
            createdAt: { $gte: startOfMonth, $lte: endOfMonth } 
          } 
        },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);

      // Leads por origem
      const leadsBySource = await Lead.aggregate([
        { $match: { user: userId, createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
        { $group: { _id: { $ifNull: ['$source', 'Desconhecido'] }, count: { $sum: 1 } } }
      ]);

      // Conversas por canal
      const conversationsByChannel = await Conversation.aggregate([
        { $match: { user: userId, createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
        { $group: { _id: { $ifNull: ['$channel', 'Outro'] }, count: { $sum: 1 } } }
      ]);

      // Leads nos últimos 30 dias
      const last30Days = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const leadsOverTime = await Lead.aggregate([
        { 
          $match: { 
            user: userId, 
            createdAt: { $gte: last30Days } 
          } 
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Estatísticas de Cobrança (Geral e Este mês)
      const debtStats = await Installment.aggregate([
        { $match: { user: userId } },
        { 
          $group: { 
            _id: null, 
            totalRecovered: { 
              $sum: { 
                $cond: [
                  { 
                    $and: [
                      { $eq: ["$status", "pago"] },
                      { $gte: ["$paidAt", startOfMonth] },
                      { $lte: ["$paidAt", endOfMonth] }
                    ]
                  }, 
                  "$paidAmount", 
                  0
                ]
              }
            },
            totalRecoveredAllTime: {
              $sum: { $cond: [{ $eq: ["$status", "pago"] }, "$paidAmount", 0] }
            },
            totalPending: { $sum: { $cond: [{ $eq: ["$status", "pendente"] }, "$amount", 0] } },
            totalOverdue: { $sum: { $cond: [{ $eq: ["$status", "atrasado"] }, "$amount", 0] } }
          }
        }
      ]);

      const spreadsheetStats = await InadimplenciaDetalhe.aggregate([
        { $match: { user: userId } },
        { 
          $group: { 
            _id: null, 
            totalRecovered: { 
              $sum: { 
                $cond: [
                  { 
                    $and: [
                      { $eq: ["$status", "pago"] },
                      { $gte: ["$paidAt", startOfMonth] },
                      { $lte: ["$paidAt", endOfMonth] }
                    ]
                  }, 
                  "$paidAmount", 
                  0
                ] 
              } 
            },
            totalRecoveredAllTime: {
              $sum: { $cond: [{ $eq: ["$status", "pago"] }, "$paidAmount", 0] }
            },
            totalOverdue: { $sum: { $cond: [{ $ne: ["$status", "pago"] }, "$total", 0] } }
          } 
        }
      ]);

      const manualFinancial = debtStats[0] || { totalRecovered: 0, totalRecoveredAllTime: 0, totalPending: 0, totalOverdue: 0 };
      const spreadsheetFinancial = spreadsheetStats[0] || { totalRecovered: 0, totalRecoveredAllTime: 0, totalOverdue: 0 };
      
      const totalRecovered = (manualFinancial.totalRecovered || 0) + (spreadsheetFinancial.totalRecovered || 0);
      const totalRecoveredAllTime = (manualFinancial.totalRecoveredAllTime || 0) + (spreadsheetFinancial.totalRecoveredAllTime || 0);
      const totalOverdue = (manualFinancial.totalOverdue || 0) + (spreadsheetFinancial.totalOverdue || 0);
      const totalPending = manualFinancial.totalPending || 0;

      logger.info(`--- [STATS DEBUG] ${req.user.email} ---`);
      logger.info(`> Leads: ${totalLeads}`);
      logger.info(`> Recovered: ${totalRecovered}`);
      logger.info(`> Overdue: ${totalOverdue}`);
      logger.info(`--- [STATS DEBUG END] ---`);
      
      const commissions = totalRecovered * 0.10; // 10% de comissão

      // Taxa de Recuperação Financeira Real: (Recuperado TOTAL / Carteira TOTAL) * 100
      const totalPortfolio = totalRecoveredAllTime + totalOverdue + totalPending;
      const conversionRate = totalPortfolio > 0 ? 
        parseFloat(((totalRecoveredAllTime / totalPortfolio) * 100).toFixed(1)) : 0;

      res.json({
        totalLeads,
        activeConversations,
        escalatedConversations,
        qualifiedLeads,
        conversionRate,
        leadsByStatus,
        leadsBySource,
        conversationsByChannel,
        leadsOverTime,
        whatsappApiCost: parseFloat((conversationsByChannel.find(c => c._id === 'whatsapp')?.count * 0.35 || 0).toFixed(2)),
        financial: {
          totalRecovered: parseFloat(totalRecovered.toFixed(2)),
          totalPending: parseFloat(totalPending.toFixed(2)),
          totalOverdue: parseFloat(totalOverdue.toFixed(2)),
          commissions: parseFloat(commissions.toFixed(2))
        }
      });
    } catch (error) {
      logger.error('Erro ao buscar estatísticas:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Atividades recentes
  async getRecentActivities(req, res) {
    try {
      const userId = req.user.id;
      const limit = req.query.limit || 10;

      // Leads recentes
      const recentLeads = await Lead.find({ user: userId })
        .sort('-createdAt')
        .limit(5)
        .select('name email company status createdAt');

      // Conversas recentes
      const recentConversations = await Conversation.find({ user: userId })
        .sort('-updatedAt')
        .limit(5)
        .populate('lead', 'name email company')
        .select('lead channel status updatedAt messages');

      // Combinar e ordenar atividades
      const activities = [
        ...recentLeads.map(lead => ({
          type: 'lead',
          id: lead._id,
          title: `Novo lead: ${lead.name}`,
          description: `${lead.company} - ${lead.email}`,
          timestamp: lead.createdAt,
          status: lead.status
        })),
        ...recentConversations.map(conv => ({
          type: 'conversation',
          id: conv._id,
          title: `Conversa atualizada: ${conv.lead?.name}`,
          description: `${conv.channel} - ${conv.messages?.length || 0} mensagens`,
          timestamp: conv.updatedAt,
          status: conv.status
        }))
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
       .slice(0, limit);

      res.json({ activities });
    } catch (error) {
      logger.error('Erro ao buscar atividades recentes:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Estatísticas de uma campanha específica
  async getCampaignStats(req, res) {
    try {
      const userId = req.user._id;
      const { id: campaignId } = req.params;

      const campaign = await Campaign.findOne({ _id: campaignId, user: userId });

      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada.' });
      }

      // 1. Stats by status from the pre-calculated stats object
      const total = campaign.stats.total || 0;
      const sent = campaign.stats.sent || 0;
      const replied = campaign.stats.replied || 0;
      const failed = campaign.stats.failed || 0;
      
      const sentButNotReplied = sent - replied;
      const pending = total - (sent + failed);

      const statsByStatus = [
        { name: 'Pendentes', value: pending < 0 ? 0 : pending },
        { name: 'Enviados', value: sentButNotReplied },
        { name: 'Respondidos', value: replied },
        { name: 'Falhas', value: failed }
      ].filter(item => item.value > 0);

      // 2. Activity over time (aggregation)
      const activityOverTime = await Campaign.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(campaignId) } },
        { $unwind: '$contacts' },
        { $match: { 'contacts.sentAt': { $ne: null } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$contacts.sentAt" } },
            sentCount: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } },
        { $limit: 30 }
      ]);
      
      const formattedActivity = activityOverTime.map(item => ({
        date: item._id, // YYYY-MM-DD
        sent: item.sentCount,
      }));

      res.json({
        campaignName: campaign.name,
        statsByStatus,
        activityOverTime: formattedActivity,
      });

    } catch (error) {
      logger.error('Erro ao buscar estatísticas da campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new DashboardController();