const logger = require('../utils/logger');
const Debt = require('../models/Debt');
const Installment = require('../models/Installment');
const InadimplenciaDetalhe = require('../models/InadimplenciaDetalhe');

class FinanceService {
  /**
   * Calcula o valor atualizado de uma parcela com juros e multa.
   * @param {object} installment - O objeto da parcela.
   * @param {object} debt - O objeto da dívida (para taxas).
   * @returns {object} - Objeto com valor original, juros, multa e total.
   */
  calculateUpdatedAmount(installment, debt) {
    const today = new Date();
    const dueDate = new Date(installment.dueDate);
    
    let originalAmount = installment.amount;
    let interest = 0;
    let penalty = 0;
    
    if (today > dueDate && installment.status !== 'pago') {
      // Cálculo de multa fixa (ex: 2%)
      penalty = originalAmount * (debt.penaltyRate / 100);
      
      // Cálculo de juros simples proporcional aos dias de atraso (ex: 1% ao mês)
      const diffTime = Math.abs(today - dueDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Juros = (Valor * TaxaMensal / 30) * DiasAtraso
      interest = (originalAmount * (debt.interestRate / 100) / 30) * diffDays;
    }
    
    return {
      originalAmount,
      interest: parseFloat(interest.toFixed(2)),
      penalty: parseFloat(penalty.toFixed(2)),
      total: parseFloat((originalAmount + interest + penalty).toFixed(2))
    };
  }

  /**
   * Realiza a baixa de todas as parcelas de um devedor.
   */
  async payAllInstallments(leadId) {
    const debt = await Debt.findOne({ lead: leadId });
    
    // 1. Processa parcelas vinculadas a Debt
    if (debt) {
      const installments = await Installment.find({ debt: debt._id, status: { $ne: 'pago' } });
      for (const inst of installments) {
        const updated = this.calculateUpdatedAmount(inst, debt);
        inst.paidAmount = updated.total;
        inst.paidAt = new Date();
        inst.paymentMethod = 'transfer';
        inst.status = 'pago';
        await inst.save();
      }
      await this.updateDebtBalance(debt._id);
    }

    // 2. Processa registros de planilhas (InadimplenciaDetalhe)
    const spreadsheetRecords = await InadimplenciaDetalhe.find({ lead: leadId, status: { $ne: 'pago' } });
    for (const rec of spreadsheetRecords) {
      rec.paidAmount = rec.total; // Nas planilhas o total já vem calculado
      rec.paidAt = new Date();
      rec.paymentMethod = 'transfer';
      rec.status = 'pago';
      await rec.save();
    }

    if (!debt && spreadsheetRecords.length === 0) {
      throw new Error('Dívida não encontrada para este devedor');
    }

    return debt;
  }

  /**
   * Realiza a baixa de um pagamento em uma parcela.
   */
  async processPayment(installmentId, amount, paymentMethod) {
    let target = await Installment.findById(installmentId);
    let isSpreadsheet = false;

    if (!target) {
      target = await InadimplenciaDetalhe.findById(installmentId);
      isSpreadsheet = true;
    }

    if (!target) throw new Error('Parcela não encontrada');
    if (target.status === 'pago') throw new Error('Esta parcela já está paga');

    target.paidAmount = amount;
    target.paidAt = new Date();
    target.paymentMethod = paymentMethod;
    target.status = 'pago';
    await target.save();

    if (!isSpreadsheet) {
      await this.updateDebtBalance(target.debt);
    }
    
    return target;
  }

  /**
   * Recalcula o saldo devedor de uma dívida.
   */
  async updateDebtBalance(debtId) {
    const debt = await Debt.findById(debtId);
    const installments = await Installment.find({ debt: debtId });
    
    const totalPaid = installments.reduce((acc, inst) => acc + (inst.paidAmount || 0), 0);
    debt.currentBalance = Math.max(0, debt.originalAmount - totalPaid);
    
    if (debt.currentBalance === 0) {
      debt.status = 'liquidado';
    }
    
    await debt.save();
    return debt;
  }
}

module.exports = new FinanceService();
