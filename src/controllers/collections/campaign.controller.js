const { getModel } = require('../../utils/modelProvider');
const Campaign = getModel('Campaign');
const WhatsAppInstance = getModel('WhatsAppInstance');
const csvParser = require('csv-parser');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const campaignService = require('../../services/campaignService');
const aiService = require('../../services/aiService');
const metaTemplateService = require('../../services/metaTemplateService');
const logger = require('../../utils/logger');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const newFilename = `campaign-${Date.now()}-${file.originalname}`;
    cb(null, newFilename);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      const error = new Error('Apenas arquivos CSV, XLSX ou XLS sao permitidos');
      cb(error, false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const CONTACT_COLUMN_ALIASES = {
  name: [
    'nome', 'nome completo', 'nome cliente', 'cliente', 'contato', 'lead',
    'pessoa', 'responsavel', 'responsavel financeiro', 'titular', 'devedor'
  ],
  phone: [
    'telefone', 'telefone celular', 'celular', 'whatsapp', 'whats', 'phone',
    'fone', 'tel', 'numero', 'numero telefone', 'numero whatsapp',
    'telefone 1', 'tel 1', 'contato telefone'
  ],
  email: [
    'email', 'e-mail', 'mail', 'correio', 'correio eletronico',
    'endereco email', 'email cliente'
  ],
  company: [
    'empresa', 'company', 'companhia', 'organizacao', 'organizacao cliente',
    'razao social', 'credor', 'loja', 'unidade'
  ],
  position: [
    'cargo', 'funcao', 'position', 'role', 'titulo', 'ocupacao'
  ],
  segment: [
    'segmento', 'segment', 'ramo', 'area', 'setor', 'mercado'
  ],
  city: [
    'cidade', 'city', 'municipio', 'localidade'
  ],
  notes: [
    'observacoes', 'observacao', 'obs', 'notes', 'nota', 'comentarios',
    'comentario', 'detalhes'
  ],
};

const CAMPAIGN_IMPORT_FIELDS = Object.keys(CONTACT_COLUMN_ALIASES);

const normalizeHeader = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const compactHeader = (value = '') => normalizeHeader(value).replace(/\s+/g, '');

const buildHeaderIndex = (headers) => headers.map(header => ({
  original: header,
  normalized: normalizeHeader(header),
  compact: compactHeader(header),
}));

const findHeaderByAliases = (headerIndex, aliases) => {
  const normalizedAliases = aliases.map(normalizeHeader);
  const compactAliases = aliases.map(compactHeader);

  const exactMatch = headerIndex.find(header =>
    normalizedAliases.includes(header.normalized) || compactAliases.includes(header.compact)
  );
  if (exactMatch) return exactMatch.original;

  const contextualMatch = headerIndex.find(header =>
    normalizedAliases.some(alias => alias.length > 3 && header.normalized.includes(alias))
  );

  return contextualMatch?.original || null;
};

const mapColumnsByAliases = (headers) => {
  const headerIndex = buildHeaderIndex(headers);
  return CAMPAIGN_IMPORT_FIELDS.reduce((mapping, field) => {
    mapping[field] = findHeaderByAliases(headerIndex, CONTACT_COLUMN_ALIASES[field]);
    return mapping;
  }, {});
};

const getRequiredContactFields = (channel) => {
  if (channel === 'email') return ['name', 'email'];
  if (channel === 'whatsapp' || channel === 'whatsapp_official') return ['name', 'phone'];
  return [];
};

const getMissingRequiredFields = (mapping, channel) => (
  getRequiredContactFields(channel).filter(field => !mapping[field])
);

const getRowHeaders = (rows) => {
  const headers = [];
  const seen = new Set();

  rows.forEach(row => {
    Object.keys(row || {}).forEach(key => {
      const header = String(key || '').trim().replace(/^\uFEFF/, '');
      if (header && !seen.has(header)) {
        seen.add(header);
        headers.push(header);
      }
    });
  });

  return headers;
};

const normalizeRowKeys = (row) => Object.entries(row || {}).reduce((normalized, [key, value]) => {
  const cleanKey = String(key || '').trim().replace(/^\uFEFF/, '');
  if (cleanKey) normalized[cleanKey] = value == null ? '' : String(value).trim();
  return normalized;
}, {});

const detectCsvSeparator = (fileContent) => {
  const firstLine = fileContent.split(/\r?\n/).find(line => line.trim()) || '';
  const candidates = [',', ';', '\t'];
  return candidates
    .map(separator => ({
      separator,
      count: (firstLine.match(new RegExp(separator === '\t' ? '\\t' : `\\${separator}`, 'g')) || []).length,
    }))
    .sort((a, b) => b.count - a.count)[0]?.separator || ',';
};

const readCsvRows = (filePath) => new Promise((resolve, reject) => {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const separator = detectCsvSeparator(fileContent);
  const rows = [];

  fs.createReadStream(filePath)
    .pipe(csvParser({
      separator,
      mapHeaders: ({ header }) => String(header || '').trim().replace(/^\uFEFF/, ''),
    }))
    .on('data', row => rows.push(normalizeRowKeys(row)))
    .on('end', () => resolve(rows))
    .on('error', reject);
});

const readSpreadsheetRows = (filePath) => {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  return workbook.SheetNames.flatMap(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false })
      .map(normalizeRowKeys);
  });
};

const readCampaignContactsFile = async (filePath, originalName) => {
  const extension = path.extname(originalName).toLowerCase();
  if (extension === '.csv') return readCsvRows(filePath);
  if (extension === '.xlsx' || extension === '.xls') return readSpreadsheetRows(filePath);
  throw new Error('Formato de arquivo nao suportado');
};

const getMappedValue = (row, mapping, field) => {
  const header = mapping[field];
  if (!header) return '';
  return String(row[header] || '').trim();
};

const inferColumnsWithAI = async ({ headers, sampleRows, channel, currentMapping }) => {
  try {
    const result = await aiService.inferCampaignContactColumns({
      headers,
      sampleRows,
      channel,
      currentMapping,
    });

    const inferredMapping = result?.mapping || {};
    const validHeaders = new Set(headers);
    const mapping = { ...currentMapping };

    CAMPAIGN_IMPORT_FIELDS.forEach(field => {
      const inferredHeader = inferredMapping[field];
      if (!mapping[field] && inferredHeader && validHeaders.has(inferredHeader)) {
        mapping[field] = inferredHeader;
      }
    });

    return {
      mapping,
      aiConfidence: result?.confidence ?? null,
      aiReasoning: result?.reasoning || '',
    };
  } catch (error) {
    logger.warn('IA nao conseguiu inferir colunas de campanha:', error.message);
    return { mapping: currentMapping, aiConfidence: null, aiReasoning: '' };
  }
};

class CampaignController {
  
  async list(req, res) {
    const { page = 1, limit = 10, status } = req.query;
    try {
      const filter = { user: req.user.id };
      if (status) filter.status = status;

      const campaigns = await Campaign.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .select('-contacts');

      const total = await Campaign.countDocuments(filter);

      res.json({
        campaigns,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total
      });
    } catch (error) {
      logger.error('Erro ao listar campanhas:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async getById(req, res) {
    try {
      const campaign = await Campaign.findOne({
        _id: req.params.id,
        user: req.user.id
      });

      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }

      res.json(campaign);
    } catch (error) {
      logger.error('Erro ao buscar campanha por ID:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async create(req, res) {
    try {
      const {
        name, description, messageTemplate, whatsappInstance, delayBetweenMessages,
        dailyLimit, workingHours, workingDays, autoQualification, channel,
        emailSubject, followUp
      } = req.body;

      if (channel === 'whatsapp_official' && !whatsappInstance) {
        return res.status(400).json({ message: 'O ID da instância do WhatsApp Oficial é obrigatório.' });
      }
      if (whatsappInstance) {
        const instance = await WhatsAppInstance.findOne({ _id: whatsappInstance, user: req.user.id });
        if (!instance) {
          return res.status(404).json({ message: 'Instância do WhatsApp Oficial não encontrada ou não pertence a este usuário.' });
        }
      }

      const campaign = new Campaign({
        name, description, messageTemplate, whatsappInstance, channel, emailSubject,
        delayBetweenMessages, dailyLimit, workingHours, workingDays, autoQualification,
        user: req.user.id,
        followUp,
      });

      await campaign.save();

      res.status(201).json(campaign);
    } catch (error) {
      logger.error('Erro ao criar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async uploadContacts(req, res) {
    const uploadMiddleware = upload.single('csvFile');
    
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'Arquivo CSV, XLSX ou XLS e obrigatorio' });
      }

      try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
        if (!campaign) {
          fs.unlinkSync(req.file.path);
          return res.status(404).json({ message: 'Campanha não encontrada' });
        }
        
        const rows = await readCampaignContactsFile(req.file.path, req.file.originalname);
        if (!rows.length) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: 'O arquivo nao possui linhas para importar' });
        }

        const headers = getRowHeaders(rows);
        let columnMapping = mapColumnsByAliases(headers);
        let mappingSource = 'automatic';
        let aiConfidence = null;
        let aiReasoning = '';

        if (getMissingRequiredFields(columnMapping, campaign.channel).length > 0) {
          const aiResult = await inferColumnsWithAI({
            headers,
            sampleRows: rows.slice(0, 8),
            channel: campaign.channel,
            currentMapping: columnMapping,
          });

          columnMapping = aiResult.mapping;
          aiConfidence = aiResult.aiConfidence;
          aiReasoning = aiResult.aiReasoning;
          if (aiConfidence !== null) mappingSource = 'ai-assisted';
        }

        const missingFields = getMissingRequiredFields(columnMapping, campaign.channel);
        if (missingFields.length > 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({
            message: `Nao foi possivel reconhecer as colunas obrigatorias: ${missingFields.join(', ')}`,
            detectedColumns: headers,
            columnMapping,
          });
        }

        const contacts = [];
        const errors = [];

        rows.forEach((row, index) => {
          const rowNumber = index + 2;
          const name = getMappedValue(row, columnMapping, 'name') || getMappedValue(row, columnMapping, 'company');

          if (!name) {
            errors.push(`Linha ${rowNumber} sem nome reconhecido`);
            return;
          }

          const contact = {
            name,
            company: getMappedValue(row, columnMapping, 'company'),
            position: getMappedValue(row, columnMapping, 'position'),
            segment: getMappedValue(row, columnMapping, 'segment'),
            city: getMappedValue(row, columnMapping, 'city'),
            notes: getMappedValue(row, columnMapping, 'notes'),
          };

          if (campaign.channel === 'whatsapp' || campaign.channel === 'whatsapp_official') {
            const rawPhone = getMappedValue(row, columnMapping, 'phone');
            let phone = rawPhone.replace(/\D/g, '').replace(/^0+/, '');
            if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) {
              phone = `55${phone}`;
            }
            if (phone.length < 12 || phone.length > 13) {
              errors.push(`Telefone invalido na linha ${rowNumber}: ${rawPhone || 'vazio'}`);
              return;
            }
            contact.phone = phone;
          } else if (campaign.channel === 'email') {
            const email = getMappedValue(row, columnMapping, 'email').toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(email)) {
              errors.push(`Email invalido na linha ${rowNumber}: ${email || 'vazio'}`);
              return;
            }
            contact.email = email;
          } else {
            errors.push(`Canal de campanha invalido: ${campaign.channel}`);
            return;
          }

          contacts.push(contact);
        });

        if (!contacts.length) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({
            message: 'Nenhum contato valido foi encontrado no arquivo',
            errors: errors.slice(0, 10),
            totalErrors: errors.length,
            detectedColumns: headers,
            columnMapping,
          });
        }

        const uniqueContacts = contacts.filter((contact, index, self) => {
          const key = (campaign.channel === 'email') ? 'email' : 'phone';
          return index === self.findIndex(c => c[key] === contact[key]);
        });

        const duplicatesRemoved = contacts.length - uniqueContacts.length;

        campaign.contacts = uniqueContacts;
        await campaign.updateStats();

        fs.unlinkSync(req.file.path);

        res.json({
          message: 'Contatos importados com sucesso',
          imported: uniqueContacts.length,
          duplicatesRemoved,
          errors: errors.slice(0, 10),
          totalErrors: errors.length,
          detectedColumns: headers,
          columnMapping,
          mappingSource,
          aiConfidence,
          aiReasoning,
        });
      } catch (error) {
        logger.error('Erro interno no uploadContacts:', error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Erro interno do servidor' });
      }
    });
  }

  // ==========================================================
  //  ✅ INICIAR CAMPANHA (Com Status 'Completed' Corrigido)
  // ==========================================================
  async start(req, res) {
    let campaign; 

    try {
      campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }

      if (campaign.status !== 'draft' && campaign.status !== 'paused') {
        return res.status(400).json({ message: 'Campanha deve estar em rascunho ou pausada' });
      }
      
      const pendingContacts = campaign.contacts.filter(c => c.status === 'pending');
      if (pendingContacts.length === 0) {
        return res.status(400).json({ message: 'Campanha não tem contatos pendentes' });
      }

      // SE FOR WHATSAPP OFICIAL, USAMOS O SERVICE INTELIGENTE
      if (campaign.channel === 'whatsapp_official') {
        
        const campaignData = await Campaign.findById(campaign._id)
          .populate('whatsappInstance')
          .populate('messageTemplate');

        const { whatsappInstance, messageTemplate } = campaignData;

        if (!whatsappInstance || !whatsappInstance.apiCredentials?.token) {
          return res.status(400).json({ message: 'Instância do WhatsApp associada não foi encontrada ou não possui token.' });
        }
        
        if (!messageTemplate || messageTemplate.status !== 'approved') {
          return res.status(400).json({ message: 'Template do WhatsApp não encontrado ou não está Aprovado.' });
        }

        const phoneNumbers = pendingContacts.map(c => c.phone);
        const contactNames = {};
        pendingContacts.forEach(contact => {
          contactNames[contact.phone] = contact.name;
        });

        logger.info(`[Dispatch] Delegando envio da campanha ${campaign.name} para o Service...`);

        // Chamamos a função 'sendCampaign' que já tem a lógica de fallback
        const results = await metaTemplateService.sendCampaign(
          whatsappInstance,
          messageTemplate.name,
          phoneNumbers,
          messageTemplate.components,
          contactNames,
          messageTemplate.sampleMediaUrl
        );
        
        // Processa a resposta
        
        // CASO 1: Sucesso em Lote (MM LITE)
        if (results.method === 'MM_LITE') {
          logger.info(`[Dispatch] Sucesso via MM Lite. Campanha ID: ${results.campaign_id}`);
          
          campaign.status = 'completed'; // CORRIGIDO
          campaign.completedAt = new Date(); // CORRIGIDO
          campaign.metaCampaignId = results.campaign_id;
          campaign.startedAt = new Date();
          
          campaign.contacts.forEach(contact => {
            if (contact.status === 'pending') {
              contact.status = 'sent';
              contact.sentAt = new Date();
              contact.messageId = results.campaign_id; 
            }
          });

          await campaign.save();
          await campaign.updateStats();

          return res.json({ 
            message: 'Campanha MM Lite concluída com sucesso!', 
            campaign: { _id: campaign._id, status: campaign.status, stats: campaign.stats },
            method: 'mm_lite_batch'
          });
        }
        
        // CASO 2: Retorno Individual (Fallback)
        const successCount = results.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;

        logger.info(`[Dispatch] Retorno de Fallback Individual: ${successCount} sucessos, ${failedCount} falhas.`);

        campaign.status = successCount > 0 ? 'completed' : 'failed'; // CORRIGIDO
        campaign.startedAt = new Date();
        campaign.completedAt = new Date(); // CORRIGIDO
        campaign.fallbackUsed = true;
        
        campaign.contacts.forEach(contact => {
          if (contact.status === 'pending') {
            const result = results.find(r => r.phone === contact.phone);
            if (result && result.success) {
              contact.status = 'sent';
              contact.sentAt = new Date();
              contact.messageId = result.messageId;
            } else {
              contact.status = 'failed';
              contact.failureReason = result?.error || 'Erro desconhecido no envio de fallback';
            }
          }
        });

        await campaign.save();
        await campaign.updateStats();

        return res.json({ 
          message: `Campanha concluída com fallback individual! ${successCount} enviados, ${failedCount} falhas.`,
          campaign: { _id: campaign._id, status: campaign.status, stats: campaign.stats },
          method: 'individual_fallback',
          results: { success: successCount, failed: failedCount }
        });

      } else {
        // SE FOR EMAIL OU WHATSAPP NÃO-OFICIAL (LOOP LENTO)
        // Aqui o status 'running' está CORRETO
        campaign.status = 'running';
        campaign.startedAt = new Date();
        await campaign.save();

        const io = req.app.get('io');
        setTimeout(() => {
          // O service será responsável por mudar para 'completed'
          campaignService.processCampaign(campaign._id, io); 
        }, 10);

        res.json({ message: 'Campanha iniciada (em processamento em segundo plano)', campaign });
      }

    } catch (error) {
      logger.error(`Erro fatal ao iniciar campanha: ${error.message}`, error);
      
      if (campaign) {
        campaign.status = 'failed';
        await campaign.save();
      }
      
      res.status(500).json({ 
        message: `Erro ao iniciar campanha: ${error.message}`,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  async pause(req, res) {
    try {
      const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id },
        { status: 'paused' },
        { new: true }
      );
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }

      campaignService.stopCampaign(campaign._id); 
      
      res.json({ message: 'Campanha pausada', campaign });
    } catch (error) {
      logger.error('Erro ao pausar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async cancel(req, res) {
    try {
      const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }
      
      if (['completed', 'cancelled'].includes(campaign.status)) {
        return res.status(400).json({ message: 'Campanha já foi concluída ou cancelada.' });
      }
      
      campaign.status = 'cancelled';
      campaign.completedAt = new Date();
      await campaign.save();
      
      campaignService.stopCampaign(campaign._id);
      
      res.json({ success: true, message: 'Campanha cancelada com sucesso', campaign });
    } catch (error) {
      logger.error('Erro ao cancelar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async delete(req, res) {
    try {
      const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }
      
      if (campaign.status === 'running') {
        return res.status(400).json({ message: 'Não é possível deletar uma campanha em execução. Pause-a primeiro.' });
      }
      
      await Campaign.findByIdAndDelete(campaign._id);
      res.json({ success: true, message: 'Campanha deletada permanentemente' });
    } catch (error) {
      logger.error('Erro ao deletar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async duplicate(req, res) {
    try {
      const originalCampaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
      if (!originalCampaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }

      const duplicatedCampaign = new Campaign({
        name: `${originalCampaign.name} (Cópia)`,
        description: originalCampaign.description,
        channel: originalCampaign.channel,
        emailSubject: originalCampaign.emailSubject,
        messageTemplate: originalCampaign.messageTemplate,
        whatsappInstance: originalCampaign.whatsappInstance,
        delayBetweenMessages: originalCampaign.delayBetweenMessages,
        dailyLimit: originalCampaign.dailyLimit,
        workingHours: originalCampaign.workingHours,
        workingDays: originalCampaign.workingDays,
        autoQualification: originalCampaign.autoQualification,
        user: req.user.id,
        contacts: [], 
        status: 'draft' 
      });

      await duplicatedCampaign.save();
      
      res.status(201).json({ success: true, message: 'Campanha duplicada com sucesso', campaign: duplicatedCampaign });
    } catch (error) {
      logger.error('Erro ao duplicar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async update(req, res) {
    try {
      const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }
      if (campaign.status === 'running') {
        return res.status(400).json({ message: 'Não é possível editar uma campanha em execução.' });
      }

      
      const { name, description, messageTemplate, emailSubject, delayBetweenMessages, dailyLimit, followUp } = req.body;

      campaign.name = name ?? campaign.name;
      campaign.description = description ?? campaign.description;
      campaign.messageTemplate = messageTemplate ?? campaign.messageTemplate;
      campaign.emailSubject = emailSubject ?? campaign.emailSubject;
      campaign.delayBetweenMessages = delayBetweenMessages ?? campaign.delayBetweenMessages;
      campaign.dailyLimit = dailyLimit ?? campaign.dailyLimit;

      if (followUp) {
        Object.assign(campaign.followUp, followUp); 
      }
      
      campaign.markModified('followUp'); 

      await campaign.save();

      res.json({ success: true, message: 'Campanha atualizada com sucesso', campaign });
    } catch (error) {
      logger.error('Erro ao atualizar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async getStats(req, res) {
    try {
      const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id }).select('stats');
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' }); 
      }
      res.json(campaign.stats);
    } catch (error) {
      logger.error('Erro ao obter estatísticas:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async generateTemplate(req, res) {
    try {
      const { name, description, channel } = req.body;
      if (!name || !description) {
        return res.status(400).json({ message: 'O nome e a descrição são necessários.' });
      }
      
      const template = await aiService.generateCampaignTemplate({ name, description, channel });
      
      res.json({ success: true, template });
    } catch (error) {
      logger.error('Erro ao gerar template com IA:', error);
      res.status(500).json({ message: 'Erro ao gerar template com IA' });
    }
  }

  async restart(req, res) {
    try {
      const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
      if (!campaign) {
        return res.status(404).json({ message: 'Campanha não encontrada' });
      }
      if (campaign.status === 'running') {
        return res.status(400).json({ message: 'Pause a campanha antes de reiniciá-la.' });
      }

      campaign.status = 'draft';
      
      campaign.contacts.forEach(contact => {
          contact.status = 'pending';
          contact.sentAt = null;
          contact.failureReason = null;
          contact.messageId = null;
          contact.followUpStatus = undefined; 
      });
      
      campaign.stats = { total: campaign.contacts.length, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
      campaign.startedAt = null;
      campaign.completedAt = null;
      
      await campaign.save();
      res.json({ success: true, message: 'Campanha reiniciada com sucesso. Status resetado para "draft".', campaign });
    } catch (error) {
      logger.error('Erro ao reiniciar campanha:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async checkMigration(req, res) {
    try {
      const { instanceId } = req.params;
      const userId = req.user.id;

      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId })
          .select('+apiCredentials') 
          .lean(); 

      if (!instance) {
        return res.status(404).json({ message: 'Instância não encontrada.' });
      }
      
      if (!instance.wabaId || !instance.apiCredentials || !instance.apiCredentials.token) {
          logger.error('[MM Lite] Falha crítica: Token ou WABA ID ausente na instância.', {
              wabaId: instance.wabaId,
              hasToken: !!instance.apiCredentials?.token
          });
          return res.status(400).json({ 
              message: 'Credenciais da instância (Token ou WABA ID) não encontradas. Verifique a configuração no banco.',
          });
      }

      const migrationStatus = await metaTemplateService.checkMigrationStatus(instance);
      
      res.json({
        success: true,
        migrationStatus,
        instance: {
          id: instance._id,
          name: instance.instanceName,
          wabaId: instance.wabaId
        }
      });

    } catch (error) {
      logger.error('Erro ao verificar status de migração:', error);
      res.status(500).json({ 
        message: `Erro ao verificar migração: ${error.message}`,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

module.exports = new CampaignController();
