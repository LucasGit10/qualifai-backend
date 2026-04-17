const fs = require('fs');
const csvParser = require('csv-parser');
const { getModel } = require('../../utils/modelProvider');
const Debt = getModel('Debt');
const Installment = getModel('Installment');
const Guarantor = getModel('Guarantor');
const Lead = getModel('Lead');
const financeService = require('../../services/financeService');
const logger = require('../../utils/logger');

class DebtController {
  async createDebt(req, res) {
    try {
      const { leadId, contractNumber, amount, installmentsCount, firstDueDate, interestRate, penaltyRate } = req.body;
      
      const debt = new Debt({
        lead: leadId,
        contractNumber,
        originalAmount: amount,
        currentBalance: amount,
        interestRate,
        penaltyRate,
        user: req.user.id
      });
      
      await debt.save();
      
      // Gerar parcelas automaticamente
      const installments = [];
      const baseAmount = amount / installmentsCount;
      
      for (let i = 1; i <= installmentsCount; i++) {
        const dueDate = new Date(firstDueDate);
        dueDate.setMonth(dueDate.getMonth() + (i - 1));
        
        installments.push({
          debt: debt._id,
          number: i,
          dueDate,
          amount: baseAmount,
          user: req.user.id
        });
      }
      
      await Installment.insertMany(installments);
      
      res.status(201).json({ debt, installmentsCount: installments.length });
    } catch (error) {
      logger.error('Erro ao criar dívida:', error);
      res.status(500).json({ message: 'Erro ao criar dívida' });
    }
  }

  async getDebtDetails(req, res) {
    try {
      const debt = await Debt.findOne({ _id: req.params.id, user: req.user.id }).populate('lead');
      const installments = await Installment.find({ debt: debt._id }).sort({ number: 1 });
      const guarantors = await Guarantor.find({ debt: debt._id });
      
      // Calcular valores atualizados para parcelas em atraso
      const updatedInstallments = installments.map(inst => {
        const updated = financeService.calculateUpdatedAmount(inst, debt);
        return { ...inst.toObject(), updated };
      });
      
      res.json({ debt, installments: updatedInstallments, guarantors });
    } catch (error) {
      logger.error('Erro ao buscar detalhes da dívida:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async getDebtByLead(req, res) {
    try {
      const debt = await Debt.findOne({ lead: req.params.leadId, user: req.user.id })
        .populate('lead');
      
      if (!debt) {
        return res.status(404).json({ message: 'Nenhuma dívida encontrada para este lead.' });
      }

      const installments = await Installment.find({ debt: debt._id }).sort({ number: 1 });
      const guarantors = await Guarantor.find({ debt: debt._id });

      const updatedInstallments = installments.map(inst => {
        const updated = financeService.calculateUpdatedAmount(inst, debt);
        return { ...inst.toObject(), updated };
      });
      
      res.json({ debt, installments: updatedInstallments, guarantors });
    } catch (error) {
      logger.error('Erro ao buscar dívida por lead:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async processPayment(req, res) {
    try {
      const { installmentId, amount, paymentMethod } = req.body;
      const installment = await financeService.processPayment(installmentId, amount, paymentMethod);
      
      // Verificar se a dívida foi liquidada para atualizar o lead
      const debt = await Debt.findById(installment.debt);
      if (debt && debt.status === 'liquidado') {
        await Lead.findByIdAndUpdate(debt.lead, { status: 'quitado' });
      }

      res.json({ message: 'Pagamento processado com sucesso', installment });
    } catch (error) {
      if (error.message === 'Parcela não encontrada' || error.message === 'Dívida não encontrada para este devedor') {
        return res.status(404).json({ message: error.message });
      }
      logger.error('Erro ao processar pagamento:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async payAll(req, res) {
    try {
      const { leadId } = req.params;
      const debt = await financeService.payAllInstallments(leadId);
      
      // Atualizar status do lead para 'quitado'
      await Lead.findByIdAndUpdate(leadId, { status: 'quitado' });
      
      res.json({ message: 'Todas as parcelas foram quitadas com sucesso', debt });
    } catch (error) {
      if (error.message === 'Parcela não encontrada' || error.message === 'Dívida não encontrada para este devedor') {
        return res.status(404).json({ message: error.message });
      }
      logger.error('Erro ao quitar todas as parcelas:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async addGuarantor(req, res) {
    try {
      const { debtId, name, email, phone, taxId, relationship } = req.body;
      const guarantor = new Guarantor({
        debt: debtId,
        name,
        email,
        phone,
        taxId,
        relationship,
        user: req.user.id
      });
      await guarantor.save();
      res.status(201).json(guarantor);
    } catch (error) {
      logger.error('Erro ao adicionar fiador:', error);
      res.status(500).json({ message: 'Erro ao adicionar fiador' });
    }
  }

  async uploadDebts(req, res) {
    if (!req.file) return res.status(400).json({ message: 'Arquivo CSV é obrigatório' });
    
    try {
      const results = [];
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
          let count = 0;
          for (const row of results) {
            try {
              // 1. Buscar ou criar Lead por email
              let lead = await Lead.findOne({ email: row.email.toLowerCase(), user: req.user.id });
              if (!lead) {
                lead = new Lead({
                  name: row.nome,
                  email: row.email.toLowerCase(),
                  phone: row.telefone,
                  company: 'Importado',
                  source: 'lusha', // Ou qualquer fonte padrão
                  user: req.user.id
                });
                await lead.save();
              }

              // 2. Criar Debt
              const debt = new Debt({
                lead: lead._id,
                contractNumber: row.contrato,
                originalAmount: parseFloat(row.valor),
                currentBalance: parseFloat(row.valor),
                user: req.user.id
              });
              await debt.save();

              // 3. Gerar Installments
              const installmentsCount = parseInt(row.parcelas) || 1;
              const baseAmount = debt.originalAmount / installmentsCount;
              const firstDueDate = new Date(row.vencimento);

              const installments = [];
              for (let i = 1; i <= installmentsCount; i++) {
                const dueDate = new Date(firstDueDate);
                dueDate.setMonth(dueDate.getMonth() + (i - 1));
                installments.push({
                  debt: debt._id,
                  number: i,
                  dueDate,
                  amount: baseAmount,
                  user: req.user.id
                });
              }
              await Installment.insertMany(installments);
              count++;
            } catch (err) {
              logger.error(`Erro ao importar linha: ${JSON.stringify(row)}`, err);
            }
          }
          fs.unlinkSync(req.file.path);
          res.json({ message: `${count} de ${results.length} registros processados com sucesso` });
        });
    } catch (error) {
      logger.error('Erro na importação em lote:', error);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: 'Erro ao processar arquivo' });
    }
  }

  async getAnnualSummary(req, res) {
    try {
      const installments = await Installment.find({ user: req.user.id });
      
      const summary = {};
      
      installments.forEach(inst => {
        const date = new Date(inst.dueDate);
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11
        
        if (!summary[year]) {
          summary[year] = {
            year,
            totalPaid: 0,
            totalPending: 0,
            totalOverdue: 0,
            months: Array.from({ length: 12 }, (_, i) => ({
              month: i,
              paid: 0,
              pending: 0,
              overdue: 0
            }))
          };
        }
        
        const monthData = summary[year].months[month];
        const amount = inst.amount || 0;
        
        if (inst.status === 'pago') {
          summary[year].totalPaid += amount;
          monthData.paid += amount;
        } else if (inst.status === 'atrasado') {
          summary[year].totalOverdue += amount;
          monthData.overdue += amount;
        } else {
          summary[year].totalPending += amount;
          monthData.pending += amount;
        }
      });
      
      // Convert to sorted array
      const result = Object.values(summary).sort((a, b) => b.year - a.year);
      res.json(result);
    } catch (error) {
      logger.error('Erro ao buscar resumo anual:', error);
      res.status(500).json({ message: 'Erro ao buscar resumo anual' });
    }
  }
}

module.exports = new DebtController();
