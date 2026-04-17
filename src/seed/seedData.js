const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Conversation = require('../models/Conversation');
const Debt = require('../models/Debt');
const Installment = require('../models/Installment');
const User = require('../models/User');
const MessageTemplate = require('../models/MessageTemplate');
const Campaign = require('../models/Campaign');
require('dotenv').config();

const connectDB = async () => {
  let uri = process.env.MONGODB_URI;
  // Fallback para localhost se estiver rodando fora do docker
  if (uri.includes('@mongodb:') && !process.env.DOCKER_CONTAINER) {
      uri = uri.replace('@mongodb:', '@localhost:');
  }

  try {
    console.log(`Tentando conectar ao MongoDB: ${uri.split('@')[1] || uri}`);
    await mongoose.connect(uri);
    console.log('MongoDB Conectado com sucesso!');
  } catch (err) {
    console.error('ERRO DE CONEXÃO:', err.message);
    process.exit(1);
  }
};

const seedForUser = async (userId, userEmail) => {
    console.log(`\n--- Povoando dados para: ${userEmail} ---`);

    // 1. Template
    const template = new MessageTemplate({
        user: userId,
        name: `template_${Date.now()}`,
        category: 'MARKETING',
        language: 'pt_BR',
        templateType: 'conversation',
        components: [{ type: 'BODY', text: 'Olá {{1}}!' }],
        status: 'approved'
    });
    await template.save();
    console.log('- Template OK');

    // 2. Leads (Apenas 6, bem distribuídos)
    const leadData = [
        { name: 'Lead Novo', email: 'novo@test.com', phone: '1190001', status: 'novo', user: userId },
        { name: 'Lead Contatado', email: 'cont@test.com', phone: '1190002', status: 'contatado', user: userId },
        { name: 'Lead Qualificado', email: 'qual@test.com', phone: '1190003', status: 'qualificado', user: userId },
        { name: 'Lead Escalado', email: 'esc@test.com', phone: '1190004', status: 'escaleted', user: userId },
        { name: 'Lead Ativo', email: 'ativo@test.com', phone: '1190005', status: 'ativo', user: userId },
        { name: 'Lead Pago', email: 'pago@test.com', phone: '1190006', status: 'convertido', user: userId }
    ];
    const leads = await Lead.insertMany(leadData);
    console.log(`- ${leads.length} Leads OK`);

    // 3. Campanha
    const campaign = new Campaign({
        name: 'Campanha de Recuperação',
        user: userId,
        channel: 'whatsapp',
        messageTemplate: template._id,
        status: 'running',
        stats: { total: 10, sent: 8, replied: 3, failed: 1 },
        contacts: [{ name: 'Test', phone: '1190001', status: 'sent', sentAt: new Date() }]
    });
    await campaign.save();
    console.log('- Campanha OK');

    // 4. Conversas (Apenas 10)
    const convs = [];
    for (let i = 0; i < 10; i++) {
        convs.push({
            lead: leads[i % leads.length]._id,
            user: userId,
            channel: i < 7 ? 'whatsapp' : 'email',
            status: i === 0 ? 'escalated' : 'closed',
            messages: [{ role: 'lead', content: 'Oi', channel: 'whatsapp' }],
            createdAt: new Date()
        });
    }
    await Conversation.insertMany(convs);
    console.log('- 10 Conversas OK (7 WhatsApp)');

    // 5. Dívidas (Com valores para os cards)
    for (let i = 0; i < 3; i++) {
        const lead = leads[i + 2]; // Qualificado, Escalado, Ativo
        const debt = new Debt({
            lead: lead._id,
            user: userId,
            totalAmount: 2000,
            status: 'ativo'
        });
        await debt.save();

        await Installment.insertMany([
            { debt: debt._id, user: userId, number: 1, amount: 1000, status: 'pago', paidAmount: 1000, paidAt: new Date(), createdAt: new Date() },
            { debt: debt._id, user: userId, number: 2, amount: 1000, status: 'atrasado', createdAt: new Date() }
        ]);
    }
    console.log('- Dívidas e Parcelas OK');
};

const main = async () => {
    await connectDB();
    try {
        const admins = await User.find({ role: 'admin' });
        if (admins.length === 0) {
            console.log('ERRO: Nenhum admin encontrado no banco.');
            process.exit(1);
        }

        console.log(`Limpando coleções para ${admins.length} admins...`);
        await Promise.all([
            Lead.deleteMany({}),
            Conversation.deleteMany({}),
            Debt.deleteMany({}),
            Installment.deleteMany({}),
            MessageTemplate.deleteMany({}),
            Campaign.deleteMany({})
        ]);

        for (const admin of admins) {
            await seedForUser(admin._id, admin.email);
        }

        console.log('\n✅ SEEDING CONCLUÍDO COM SUCESSO!');
        process.exit(0);
    } catch (e) {
        console.error('ERRO DURANTE SEED:', e);
        process.exit(1);
    }
};

main();
