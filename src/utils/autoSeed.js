const Lead = require('../models/Lead');
const User = require('../models/User');
const MessageTemplate = require('../models/MessageTemplate');
const Campaign = require('../models/Campaign');
const Conversation = require('../models/Conversation');
const Debt = require('../models/Debt');
const Installment = require('../models/Installment');
const mongoose = require('mongoose');

const autoSeed = async () => {
  try {
    // Para o Auto-seed, vamos ser agressivos: se houver menos de 5 leads, reflorestamos tudo
    // Isso garante que o usuário sempre veja dados "frescos" até começar a usar de verdade.
    const leadCount = await Lead.countDocuments();
    if (leadCount >= 5) {
      console.log('✅ Dados suficientes encontrados. Pulando auto-seed.');
      return;
    }

    console.log('🚀 Iniciando Auto-Seed de Dados (Data: hoje)...');

    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.log('⚠️ Seed abortado: Nenhum usuário admin encontrado.');
      return;
    }

    const userId = admin._id;
    const today = new Date();

    // Limpeza rápida para garantir que não duplicamos bizarramente
    await Promise.all([
        Lead.deleteMany({ user: userId }),
        Conversation.deleteMany({ user: userId }),
        Debt.deleteMany({ user: userId }),
        Installment.deleteMany({ user: userId }),
        Campaign.deleteMany({ user: userId })
    ]);

    // 1. Template
    const template = new MessageTemplate({
        user: userId,
        name: `template_venda_${Date.now()}`,
        category: 'MARKETING',
        language: 'pt_BR',
        templateType: 'conversation',
        components: [{ type: 'BODY', text: 'Olá {{1}}! Temos uma proposta incrível para você.' }],
        status: 'approved'
    });
    await template.save();

    // 2. Leads (Exatamente 9 leads para um funil bonito)
    const leadData = [
        { name: 'Ricardo Financeiro', email: 'ricardo@test.com', phone: '1190001', status: 'convertido', source: 'whatsapp', user: userId, createdAt: today },
        { name: 'Fernanda Leads', email: 'fernanda@test.com', phone: '1190002', status: 'qualificado', source: 'linkedin', user: userId, createdAt: today },
        { name: 'Marcos Inova', email: 'marcos@test.com', phone: '1190003', status: 'novo', source: 'form', user: userId, createdAt: today },
        { name: 'Juliana Cobrança', email: 'juli@test.com', phone: '1190004', status: 'ativo', source: 'whatsapp', user: userId, createdAt: today },
        { name: 'Bruno Urgent', email: 'bruno@test.com', phone: '1190005', status: 'escaleted', source: 'email', user: userId, createdAt: today },
        { name: 'Alice Rocha', email: 'alice@test.com', phone: '1190006', status: 'contatado', source: 'whatsapp', user: userId, createdAt: today },
        { name: 'Roberto Pagador', email: 'roberto@test.com', phone: '1190007', status: 'quitado', source: 'whatsapp', user: userId, createdAt: today },
        { name: 'Clara Justiça', email: 'clara@test.com', phone: '1190008', status: 'judicial', source: 'whatsapp', user: userId, createdAt: today },
        { name: 'Daniel Morno', email: 'daniel@test.com', phone: '1190009', status: 'morno', source: 'whatsapp', user: userId, createdAt: today }
    ];
    const leads = await Lead.insertMany(leadData);

    // 3. Campanha Localizada
    const campaign = new Campaign({
        name: 'Campanha Recuperação Ativa 2024',
        user: userId,
        channel: 'whatsapp',
        messageTemplate: template._id,
        status: 'running',
        stats: { total: 100, sent: 75, delivered: 70, read: 40, replied: 25, failed: 2 },
        contacts: leads.map(l => ({ name: l.name, phone: l.phone, status: 'sent', sentAt: today }))
    });
    await campaign.save();

    // 4. Conversas (Para gerar custo de WhatsApp)
    const convs = [];
    for (let i = 0; i < 15; i++) {
        convs.push({
            lead: leads[i % leads.length]._id,
            user: userId,
            channel: i < 10 ? 'whatsapp' : 'email',
            status: i % 5 === 0 ? 'active' : 'closed',
            messages: [{ role: 'ai', content: 'Olá, em que posso ajudar?', channel: 'whatsapp', createdAt: today }],
            createdAt: today
        });
    }
    await Conversation.insertMany(convs);

    // 5. Cobrança - O Coração do pedido do usuário
    // Vamos criar dívidas para os leads 'ativo', 'quitado', 'judicial' e 'convertido'
    const debtorLeads = leads.filter(l => ['ativo', 'quitado', 'judicial', 'convertido'].includes(l.status));

    for (const lead of debtorLeads) {
        const debt = new Debt({
            lead: lead._id,
            user: userId,
            totalAmount: 3000,
            status: lead.status === 'quitado' ? 'quitado' : 'ativo',
            description: 'Contrato de Serviços AI'
        });
        await debt.save();

        // 3 Parcelas: 1 Paga, 1 Vencida (Atrasada), 1 Pendente
        const installments = [
            { 
                debt: debt._id, user: userId, installmentNumber: 1, amount: 1000, 
                status: 'pago', paidAmount: 1000, paymentDate: today, dueDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
                createdAt: today 
            },
            { 
                debt: debt._id, user: userId, installmentNumber: 2, amount: 1000, 
                status: 'atrasado', dueDate: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000),
                createdAt: today 
            },
            { 
                debt: debt._id, user: userId, installmentNumber: 3, amount: 1000, 
                status: 'pendente', dueDate: new Date(today.getTime() + 25 * 24 * 60 * 60 * 1000),
                createdAt: today 
            }
        ];
        
        // Se o lead já está 'quitado', marcamos todas como pagas
        if (lead.status === 'quitado') {
            installments.forEach(inst => {
                inst.status = 'pago';
                inst.paidAmount = inst.amount;
                inst.paymentDate = today;
            });
        }

        await Installment.insertMany(installments);
    }

    console.log(`✨ Auto-Seed completo! ${leads.length} leads e cobranças geradas para o admin.`);
  } catch (error) {
    console.error('❌ Falha no Auto-Seed:', error.message);
  }
};

module.exports = autoSeed;
