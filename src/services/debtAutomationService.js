const { getModel } = require('../utils/modelProvider');
const Installment = getModel('Installment');
const Debt = getModel('Debt');
const whatsappService = require('./whatsappService');
const emailService = require('./emailService');
const logger = require('../utils/logger');

class DebtAutomationService {
  /**
   * Verifica parcelas que vencem em X dias ou que já estão atrasadas.
   */
  async processBillingRoutine() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rules = [
      { days: 5, type: 'pre_vencimento' },
      { days: 0, type: 'dia_vencimento' },
      { days: -10, type: 'pos_vencimento' }
    ];

    for (const rule of rules) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + rule.days);
      const nextDay = new Date(targetDate);
      nextDay.setDate(targetDate.getDate() + 1);

      const installments = await Installment.find({
        dueDate: { $gte: targetDate, $lt: nextDay },
        status: rule.days < 0 ? 'atrasado' : 'pendente'
      }).populate({
        path: 'debt',
        populate: { path: 'lead' }
      });

      for (const inst of installments) {
        await this.sendNotification(inst, rule.type);
      }
    }
  }

  async sendNotification(installment, type) {
    const lead = installment.debt.lead;
    const amount = installment.amount.toFixed(2);
    const dueDate = installment.dueDate.toLocaleDateString('pt-BR');
    
    let message = '';
    if (type === 'pre_vencimento') {
      message = `Olá ${lead.name}, lembrete: sua parcela de R$ ${amount} vence em 5 dias (${dueDate}).`;
    } else if (type === 'dia_vencimento') {
      message = `Olá ${lead.name}, sua parcela de R$ ${amount} vence hoje (${dueDate}).`;
    } else if (type === 'pos_vencimento') {
      message = `Olá ${lead.name}, notamos que sua parcela de R$ ${amount} vencida em ${dueDate} ainda não foi paga.`;
    }

    try {
      if (lead.phone) {
        // Mock de instância: em produção, buscar a instância vinculada ao usuário
        // await whatsappService.sendTextMessage(instance, lead.phone, message);
        logger.info(`[Cobrança] WhatsApp enviado para ${lead.phone}: ${message}`);
      }
      if (lead.email) {
        // await emailService.sendEmail(lead.email, 'Lembrete de Pagamento', message);
        logger.info(`[Cobrança] Email enviado para ${lead.email}: ${message}`);
      }
    } catch (error) {
      logger.error(`Erro ao enviar notificação de cobrança para ${lead.name}:`, error);
    }
  }
}

module.exports = new DebtAutomationService();
