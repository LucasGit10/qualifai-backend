const Lead = require('../models/Lead');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const csvParser = require('csv-parser');
const xlsx = require('xlsx');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const syncLeadWithIntegrations = async (lead, userSettings) => {
    const integrations = [
        { name: 'hubspot', sync: lead.syncWithHubspot },
        { name: 'pipedrive', sync: lead.syncWithPipedrive },
        { name: 'salesforce', sync: lead.syncWithSalesforce },
        { name: 'rdstation', sync: lead.syncWithRDStation },
        { name: 'pipefy', sync: lead.syncWithPipefy },
        { name: 'zoho', sync: lead.syncWithZoho },
        { name: 'kommo', sync: lead.syncWithKommo }
    ];

    for (const integration of integrations) {
        if (userSettings?.integrations?.[integration.name]?.enabled) {
            try {
                await integration.sync.call(lead, userSettings);
            } catch (integrationError) {
                logger.warn(`Error in ${integration.name} integration for lead ${lead._id}:`, integrationError.message);
            }
        }
    }
};

// Helper function to find a property in an object with case-insensitivity
const findProp = (obj, keys) => {
    const key = Object.keys(obj).find(k => keys.includes(k.toLowerCase()));
    return key ? obj[key] : null;
};

// ====================================================================
// NOVA FUNÇÃO PARA DETECTAR O SEPARADOR DO CSV
// ====================================================================
const detectSeparator = (filePath) => {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let header = '';
    stream.on('data', (chunk) => {
      // Pega o primeiro pedaço de dados para analisar o cabeçalho
      header = chunk.toString();
      stream.destroy(); // Para de ler o arquivo, já temos o suficiente
    });
    stream.on('close', () => {
      if (!header) {
        return resolve(','); // Retorna vírgula como padrão se o arquivo for vazio
      }
      const firstLine = header.split('\n')[0];
      const commaCount = (firstLine.match(/,/g) || []).length;
      const semicolonCount = (firstLine.match(/;/g) || []).length;
      
      // Retorna o separador que aparece mais vezes
      resolve(semicolonCount > commaCount ? ';' : ',');
    });
    stream.on('error', reject);
  });
};

class LeadController {
  // Listar leads
  async getLeads(req, res) {
    try {
      const { page = 1, limit = 25, status, source, sort = '-createdAt', search } = req.query;
      const userId = req.user.id;

      const filter = { user: userId };
      if (status) filter.status = status;
      if (source) filter.source = source;
      if (search) {
        const searchRegex = { $regex: search, $options: 'i' };
        filter.$or = [
          { name: searchRegex },
          { email: searchRegex },
          { company: searchRegex },
          { position: searchRegex }
        ];
      }

      const leads = await Lead.find(filter)
        .sort(sort)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('assignedTo', 'name email');

      const total = await Lead.countDocuments(filter);

      res.json({
        leads,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page, 10),
        total
      });
    } catch (error) {
      logger.error('Erro ao listar leads:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Get a lightweight list of leads (for dropdowns)
  async getLeadList(req, res) {
    try {
      const userId = req.user.id;
      const leads = await Lead.find({ user: userId })
        .select('name company')
        .sort({ name: 1 })
        .lean();

      res.json(leads);
    } catch (error) {
      logger.error('Error fetching lead list:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Buscar lead por ID
  async getLeadById(req, res) {
    try {
      const lead = await Lead.findOne({ _id: req.params.id, user: req.user.id }).populate('assignedTo', 'name email');
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado' });
      res.json({ lead });
    } catch (error) {
      logger.error('Erro ao buscar lead:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Criar lead
  async createLead(req, res) {
    try {
      const leadData = { ...req.body, user: req.user.id };
      
      const existingLead = await Lead.findOne({ email: leadData.email, user: req.user.id });
      if (existingLead) return res.status(400).json({ message: 'Lead já existe com este email' });

      const lead = new Lead(leadData);
      await lead.save();

      const user = await User.findById(req.user.id);
      await syncLeadWithIntegrations(lead, user.settings);

      res.status(201).json({ lead });
    } catch (error) {
      logger.error('Erro ao criar lead:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Atualizar lead
  async updateLead(req, res) {
    try {
      const lead = await Lead.findOne({ _id: req.params.id, user: req.user.id });
      if (!lead) {
        return res.status(404).json({ message: 'Lead não encontrado' });
      }

      Object.assign(lead, req.body);
      
      const user = await User.findById(req.user.id);
      if (user.settings?.integrations) {
        for (const integrationName in user.settings.integrations) {
          if (user.settings.integrations[integrationName]?.enabled && lead[integrationName]) {
            lead[integrationName].syncStatus = 'pending';
          }
        }
      }

      const updatedLead = await lead.save();

      res.json({ lead: updatedLead });
    } catch (error) {
      logger.error('Erro ao atualizar lead:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Excluir lead
  async deleteLead(req, res) {
    try {
      const lead = await Lead.findOneAndDelete({ _id: req.params.id, user: req.user.id });
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado' });
      res.json({ message: 'Lead excluído com sucesso' });
    } catch (error) {
      logger.error('Erro ao excluir lead:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Excluir múltiplos leads
  async deleteMultipleLeads(req, res) {
    try {
      const { ids } = req.body;
      const userId = req.user.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Nenhum ID de lead fornecido.' });
      }

      const result = await Lead.deleteMany({
        _id: { $in: ids },
        user: userId
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: 'Nenhum lead encontrado para exclusão ou você não tem permissão.' });
      }

      res.json({ message: `${result.deletedCount} leads foram excluídos com sucesso.` });
    } catch (error) {
      logger.error('Erro ao excluir múltiplos leads:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Enviar email
  async sendEmail(req, res) {
    try {
      const { id } = req.params;
      const { subject, body } = req.body;
      const userId = req.user.id;

      if (!subject || !body) {
        return res.status(400).json({ message: 'Assunto e corpo do email são obrigatórios.' });
      }

      const lead = await Lead.findOne({ _id: id, user: userId });
      if (!lead) {
        return res.status(404).json({ message: 'Lead não encontrado.' });
      }

      const user = await User.findById(userId);
      const htmlBody = body.replace(/\n/g, '<br>');
      await emailService.sendEmail({ to: lead.email, subject, html: htmlBody, text: body }, user.settings);
      
      let conversation = await Conversation.findOne({
        lead: lead._id,
        channel: 'email',
        status: 'active'
      });

      if (!conversation) {
        conversation = new Conversation({
          lead: lead._id,
          channel: 'email',
          user: userId,
          messages: []
        });
      }

      conversation.messages.push({
        role: 'humano',
        content: `[EMAIL ENVIADO]\nAssunto: ${subject}\n\n${body}`,
        channel: 'email'
      });
      await conversation.save();

      lead.lastContact = new Date();
      await lead.save();

      res.json({ success: true, message: 'Email enviado e registrado com sucesso.' });
    } catch (error) {
      logger.error('Erro ao enviar email:', error);
      res.status(500).json({ message: error.message || 'Erro interno do servidor' });
    }
  }
  // Importar leads em massa
  async importLeads(req, res) {
    try {
      const { leads } = req.body;
      const userId = req.user.id;
      const createdLeads = [];
      const errors = [];

      for (const leadData of leads) {
        try {
          if (!await Lead.findOne({ email: leadData.email, user: userId })) {
            const lead = new Lead({ ...leadData, user: userId });
            await lead.save();
            createdLeads.push(lead);
          } else {
            errors.push(`Lead ${leadData.email} já existe`);
          }
        } catch (error) {
          errors.push(`Erro ao criar lead ${leadData.email}: ${error.message}`);
        }
      }
      res.json({ success: true, created: createdLeads.length, errors: errors.length, details: errors });
    } catch (error) {
      logger.error('Erro ao importar leads:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
  
  // Importar leads de arquivo (CSV, Excel, PDF)
// Importar leads de arquivo (CSV, Excel, PDF)
  async importLeadsFromFile(req, res) {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    }

    const userId = req.user.id;
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    
    // ====================================================================
    // OTIMIZAÇÃO PARA ARQUIVOS CSV
    // ====================================================================
    if (fileExt === '.csv') {
      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const BATCH_SIZE = 1000; // Processa 1000 linhas por vez
      let batch = [];

      // Função auxiliar para processar um lote de leads em massa
      const processBatch = async (leadBatch) => {
        if (leadBatch.length === 0) return;

        // 1. Pega todos os e-mails do lote para uma única consulta
        const emailsInBatch = leadBatch.map(record => findProp(record, ['email', 'e-mail'])?.toLowerCase()).filter(Boolean);
        
        // 2. Faz UMA consulta para encontrar TODOS os leads existentes no lote
        const existingLeads = await Lead.find({ user: userId, email: { $in: emailsInBatch } });
        const existingEmails = new Set(existingLeads.map(lead => lead.email));

        const newLeadsToCreate = [];
        
        for (const record of leadBatch) {
          const email = findProp(record, ['email', 'e-mail'])?.toLowerCase();
          
          if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            errorCount++;
            continue;
          }

          if (existingEmails.has(email)) {
            skippedCount++;
          } else {
            newLeadsToCreate.push({
              user: userId,
              email: email,
              name: findProp(record, ['name', 'nome', 'razão social', 'razao social']) || email.split('@')[0],
              company: findProp(record, ['company', 'empresa', 'nome fantasia']) || 'Não informado',
              phone: findProp(record, ['phone', 'telefone', 'celular']) || null,
              position: findProp(record, ['position', 'cargo']) || null,
              source: 'form',
            });
            existingEmails.add(email);
          }
        }
        
        // 3. Insere TODOS os novos leads do lote com UMA única operação
        if (newLeadsToCreate.length > 0) {
          await Lead.insertMany(newLeadsToCreate);
          createdCount += newLeadsToCreate.length;
        }
      };

      try {
        const separator = await detectSeparator(filePath);
        const stream = fs.createReadStream(filePath).pipe(csvParser({ separator }));

        for await (const record of stream) {
            batch.push(record);
            if (batch.length >= BATCH_SIZE) {
                await processBatch(batch);
                batch = []; // Limpa o lote para economizar memória
            }
        }
        
        await processBatch(batch); // Processa o último lote restante

        return res.json({
          success: true,
          message: 'Arquivo CSV processado com sucesso.',
          created: createdCount,
          skipped: skippedCount,
          errors: errorCount,
        });

      } catch (error) {
        logger.error('Erro ao importar leads do arquivo CSV:', error);
        return res.status(500).json({ message: 'Erro interno ao processar o arquivo CSV.' });
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // ====================================================================
    // LÓGICA ORIGINAL PARA EXCEL E PDF (não otimizada para streaming)
    // ====================================================================
    let records = [];
    try {
      if (fileExt === '.xlsx' || fileExt === '.xls') {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        records = xlsx.utils.sheet_to_json(worksheet);
      } else if (fileExt === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        const text = data.text;
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const uniqueEmails = [...new Set(text.match(emailRegex) || [])];
        records = uniqueEmails.map(email => ({ email }));
      } else {
        return res.status(400).json({ message: 'Formato de arquivo não suportado.' });
      }

      // Processamento linha a linha para Excel e PDF
      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const record of records) {
        const email = findProp(record, ['email', 'e-mail']);
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
          errorCount++;
          continue;
        }

        const existingLead = await Lead.findOne({ email: email.toLowerCase(), user: userId });
        if (existingLead) {
          skippedCount++;
          continue;
        }

        const newLead = new Lead({
          user: userId,
          email: email.toLowerCase(),
          name: findProp(record, ['name', 'nome', 'razão social', 'razao social']) || email.split('@')[0],
          company: findProp(record, ['company', 'empresa', 'nome fantasia']) || 'Não informado',
          phone: findProp(record, ['phone', 'telefone', 'celular']) || null,
          position: findProp(record, ['position', 'cargo']) || null,
          source: 'form',
        });

        await newLead.save();
        createdCount++;
      }

      return res.json({
        success: true,
        message: 'Arquivo processado.',
        created: createdCount,
        skipped: skippedCount,
        errors: errorCount,
      });
    } catch (error) {
      logger.error('Erro ao importar leads de arquivo:', error);
      return res.status(500).json({ message: 'Erro interno ao processar o arquivo.' });
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  // Sincronizar todos os leads
  async syncAllLeads(req, res) {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);
        const userSettings = { ...user.settings, userId: user._id };
        
        const integrationSyncMethods = {
            hubspot: 'syncWithHubspot',
            pipedrive: 'syncWithPipedrive',
            salesforce: 'syncWithSalesforce',
            rdstation: 'syncWithRDStation',
            pipefy: 'syncWithPipefy',
            zoho: 'syncWithZoho',
            kommo: 'syncWithKommo'
        };

        const integrationNames = Object.keys(integrationSyncMethods);
        const results = integrationNames.reduce((acc, name) => ({ ...acc, [name]: { synced: 0, errors: 0 } }), {});
        const activeIntegrations = [];

        logger.info(`[SyncAll] Iniciando ressincronização para ${userId}. Marcando leads como pendentes...`);
        for (const name of integrationNames) {
            if (user.settings?.integrations?.[name]?.enabled) {
                activeIntegrations.push(name);
                const updateQuery = { $set: { [`${name}.syncStatus`]: 'pending' } };
                await Lead.updateMany(
                    { user: userId, [name]: { $exists: true, $ne: null } },
                    updateQuery
                );
            }
        }

        if (activeIntegrations.length === 0) {
            return res.json({ success: true, message: 'Nenhuma integração ativa para sincronizar.', results: {}, activeIntegrations: [] });
        }
        
        logger.info(`[SyncAll] Leads marcados para as integrações: ${activeIntegrations.join(', ')}. Iniciando sincronização...`);
        
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        for (const name of activeIntegrations) {
            const leadsToSync = await Lead.find({
                user: userId,
                [`${name}.syncStatus`]: 'pending'
            });

            for (const lead of leadsToSync) {
                try {
                    const syncMethod = integrationSyncMethods[name];
                    await lead[syncMethod](user.settings);
                    results[name].synced++;
                } catch (error) {
                    results[name].errors++;
                    logger.warn(`Erro ao sincronizar lead ${lead._id} com ${name}: ${error.message}`);
                }
                await delay(300);
            }
        }

        res.json({ success: true, message: `Sincronização concluída.`, results, activeIntegrations });
    } catch (error) {
        logger.error('Erro ao sincronizar todos os leads:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async getLeadStatuses(req, res) {
    try {
      // Pega os valores do 'enum' diretamente do Schema do Mongoose
      const statuses = Lead.schema.path('status').enumValues;
      res.json(statuses);
    } catch (error) {
      logger.error('Erro ao buscar lista de status:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new LeadController();