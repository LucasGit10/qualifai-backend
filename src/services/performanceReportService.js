

const { getModel } = require('../utils/modelProvider');
const User = getModel('User');
const Lead = getModel('Lead');
const Event = getModel('Events');
const aiService = require('./aiService');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const evolutionApiService = require('../services/evolutionApiService');
const zapiService = require('../services/zapiService');
const logger = require('../utils/logger');
const { startOfDay, endOfDay, subDays } = require('date-fns');
const Conversation = getModel('Conversation');
const AppError = require('../utils/AppError');

class PerformanceReportService {

  // Main method called by the cron job
  async generateAndSendReports() {
    logger.info('[PerformanceReport] Starting report generation job.');
    const today = new Date();
    
    // Find all users with reports enabled
    const users = await User.find({ 'settings.performanceReport.enabled': true });
    
    logger.info(`[PerformanceReport] Found ${users.length} users with reports enabled.`);

    for (const user of users) {
      const { frequency } = user.settings.performanceReport;
      
      const isDaily = frequency === 'daily';
      const isWeekly = frequency === 'weekly' && today.getDay() === 1; // Monday
      const isMonthly = frequency === 'monthly' && today.getDate() === 1; // 1st of the month

      if (isDaily || isWeekly || isMonthly) {
        logger.info(`[PerformanceReport] Generating '${frequency}' report for user ${user.email}.`);
        try {
          // Re-using the manual report logic for simplicity
          await this.generateAndSendManualReport(user._id, frequency);
        } catch (error) {
          logger.error(`[PerformanceReport] Failed to generate report for user ${user.email}:`, error);
        }
      }
    }
    logger.info('[PerformanceReport] Report generation job finished.');
  }

  // New method for manual trigger and re-used by cron
  async generateAndSendManualReport(userId, frequency = 'daily') {
    const user = await User.findById(userId);
    if (!user || !user.settings?.performanceReport?.enabled) {
        throw new AppError('Relatórios de performance não estão habilitados para este usuário. Ative nas configurações de notificações.', 403, 'REPORT_NOT_ENABLED');
    }
    
    const { deliveryChannels, recipients } = user.settings.performanceReport;
    if (!recipients || recipients.length === 0) {
        logger.warn(`[PerformanceReport] Nenhum destinatário configurado para o usuário ${user.email}. Pulando envio.`);
        return;
    }

    logger.info(`[PerformanceReport] Generating manual '${frequency}' report for user ${user.email}.`);
    const reportData = await this.gatherReportData(userId, frequency);

    for (const recipient of recipients) {
      if (!recipient.email && !recipient.whatsappNumber) continue;

      for (const channel of deliveryChannels) {
         if ((channel === 'email' && recipient.email) || (channel === 'whatsapp' && recipient.whatsappNumber)) {
             try {
               const summary = await aiService.generatePerformanceSummary({
                 data: reportData.data,
                 recipient: { ...recipient.toObject(), channel },
                 periodText: reportData.periodText
               });
               
               if (channel === 'email') {
                 await this.sendEmailReport(user, recipient, summary, reportData.periodText);
               } else if (channel === 'whatsapp') {
                 await this.sendWhatsAppReport(user, recipient, summary);
               }
             } catch (recipientError) {
                 logger.error(`[PerformanceReport] Failed to send report to ${recipient.name} via ${channel} for user ${user.email}:`, recipientError);
             }
         }
      }
    }
  }

  // Gathers data for a specific user and period
  async gatherReportData(userId, frequency) {
    const now = new Date();
    let startDate, periodText;

    switch (frequency) {
      case 'weekly':
        startDate = startOfDay(subDays(now, 7));
        periodText = 'últimos 7 dias';
        break;
      case 'monthly':
        startDate = startOfDay(subDays(now, 30));
        periodText = 'últimos 30 dias';
        break;
      case 'daily':
      default:
        startDate = startOfDay(subDays(now, 1));
        periodText = 'últimas 24 horas';
        break;
    }
    const endDate = new Date();

    const dateFilter = { user: userId, createdAt: { $gte: startDate, $lte: endDate } };

    // Queries to the database (parallelized for efficiency)
    const [
      newLeads,
      meetingsScheduled,
      opportunitiesCreated,
      topLeadSources,
      contactedLeadsCount,
    ] = await Promise.all([
      Lead.countDocuments(dateFilter),
      Event.countDocuments({ user: userId, lead: { $exists: true }, createdAt: { $gte: startDate, $lte: endDate } }),
      Lead.countDocuments({ ...dateFilter, status: 'qualificado' }),
      Lead.aggregate([ { $match: dateFilter }, { $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 3 } ]),
      Lead.countDocuments({ ...dateFilter, status: { $ne: 'novo' } }),
    ]);

    // --- Cadence Response Rate Calculation ---
    const leadsInPeriodIds = await Lead.find(dateFilter).distinct('_id');
    const repliedConversationsCount = await Conversation.countDocuments({
        lead: { $in: leadsInPeriodIds },
        'messages.role': 'lead'
    });
    const cadenceResponseRate = contactedLeadsCount > 0
      ? Math.round((repliedConversationsCount / contactedLeadsCount) * 100)
      : 0;

    // --- Average SDR Response Time Calculation ---
    let avgSdrResponseTime = 'N/A';
    const contactedLeadsInPeriod = await Lead.find({ ...dateFilter, status: { $ne: 'novo' } }).select('_id createdAt');
    
    if (contactedLeadsInPeriod.length > 0) {
        const contactedLeadIds = contactedLeadsInPeriod.map(l => l._id);
        const conversations = await Conversation.find({ lead: { $in: contactedLeadIds } })
            .select('lead messages.role messages.timestamp')
            .sort({ 'messages.timestamp': 1 });
        
        const leadCreationTimes = new Map(contactedLeadsInPeriod.map(l => [l._id.toString(), l.createdAt]));
        const responseTimes = [];
        const processedLeads = new Set();

        for (const conv of conversations) {
            const leadId = conv.lead.toString();
            if (processedLeads.has(leadId)) continue;

            const firstAiMessage = conv.messages.find(m => m.role === 'ai');
            const creationTime = leadCreationTimes.get(leadId);

            if (firstAiMessage && creationTime) {
                const responseTimeMs = firstAiMessage.timestamp.getTime() - creationTime.getTime();
                if (responseTimeMs >= 0) {
                    responseTimes.push(responseTimeMs);
                    processedLeads.add(leadId);
                }
            }
        }

        if (responseTimes.length > 0) {
            const avgTimeMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            const avgTimeMinutes = Math.round(avgTimeMs / (1000 * 60));
            
            if (avgTimeMinutes < 1) {
                avgSdrResponseTime = `< 1 minuto`;
            } else if (avgTimeMinutes < 60) {
                avgSdrResponseTime = `${avgTimeMinutes} minuto(s)`;
            } else if (avgTimeMinutes < 1440) { // less than a day
                const avgTimeHours = (avgTimeMinutes / 60).toFixed(1);
                avgSdrResponseTime = `${avgTimeHours} hora(s)`;
            } else {
                const avgTimeDays = (avgTimeMinutes / 1440).toFixed(1);
                avgSdrResponseTime = `${avgTimeDays} dia(s)`;
            }
        }
    }
    
    const data = {
      newLeads,
      meetingsScheduled,
      opportunitiesCreated,
      topLeadSources: topLeadSources.map(s => ({ source: s._id || 'Desconhecida', count: s.count })),
      cadenceResponseRate,
      avgSdrResponseTime,
    };

    return { data, periodText };
  }
  
  // Sends the report via Email
  async sendEmailReport(user, recipient, htmlContent, periodText) {
      await emailService.sendEmail({
        to: recipient.email,
        subject: `QualifAI: Seu Resumo de Performance (${periodText})`,
        html: htmlContent,
      }, user.settings);
      logger.info(`[PerformanceReport] Email report sent to ${recipient.email} for user ${user.email}`);
  }

  // Sends the report via WhatsApp, handling different providers
  async sendWhatsAppReport(user, recipient, textContent) {
    const provider = user.settings?.integrations?.whatsappProvider;
    const phone = recipient.whatsappNumber;

    if (!provider || !phone) {
        throw new AppError('Provedor de WhatsApp ou número do destinatário do relatório não configurado. Configure nas opções de relatórios.', 422, 'REPORT_WHATSAPP_NOT_CONFIGURED');
    }

    if (provider === 'whatsapp') {
      const WhatsAppInstance = getModel('WhatsAppInstance');
      const instance = await WhatsAppInstance.findOne({ user: user._id, status: 'connected' });
      if (instance) {
        await whatsappService.sendTextMessage(instance, phone, textContent);
      } else {
        throw new AppError('Nenhuma instância do WhatsApp Oficial (Meta) conectada para envio do relatório. Conecte uma instância nas configurações.', 503, 'NO_META_INSTANCE');
      }
    } else if (provider === 'zapi') {
        const { instanceId, token } = user.settings.integrations.zapi;
        await zapiService.sendMessage(instanceId, token, phone, textContent);
    } else if (provider === 'evolution') {
        // Evolution API needs an instance name. We'll assume the first active one.
        const WhatsAppInstance = getModel('WhatsAppInstance');
        const instance = await WhatsAppInstance.findOne({ user: user._id, status: 'connected' });
        if(instance) {
            await evolutionApiService.sendMessage(instance.instanceName, phone, textContent);
        } else {
            throw new AppError('Nenhuma instância da Evolution API conectada para envio do relatório. Conecte uma instância nas configurações.', 503, 'NO_EVOLUTION_INSTANCE');
        }
    } else {
        throw new AppError(`Provedor de WhatsApp '${provider}' não é suportado para envio de relatórios.`, 422, 'UNSUPPORTED_WHATSAPP_PROVIDER');
    }

    logger.info(`[PerformanceReport] WhatsApp report sent to ${phone} for user ${user.email} via ${provider}.`);
  }
}

module.exports = new PerformanceReportService();