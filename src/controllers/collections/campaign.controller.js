const { getModel } = require('../../utils/modelProvider');
const Campaign = getModel('Campaign');
const WhatsAppInstance = getModel('WhatsAppInstance');
const csvParser = require('csv-parser');
const multer = require('multer');
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
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      const error = new Error('Apenas arquivos CSV são permitidos');
      cb(error, false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

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
        return res.status(400).json({ message: 'Arquivo CSV é obrigatório' });
      }

      try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user.id });
        if (!campaign) {
          fs.unlinkSync(req.file.path);
          return res.status(404).json({ message: 'Campanha não encontrada' });
        }
        
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const separator = fileContent.includes(';') ? ';' : ',';

        const contacts = [];
        const errors = [];
        let rowCount = 0;

        fs.createReadStream(req.file.path)
          .pipe(csvParser({ separator }))
          .on('data', (row) => {
            rowCount++;
            let identifierField, identifierValue;
            
            switch(campaign.channel) {
                case 'whatsapp':
                case 'whatsapp_official':
                    identifierField = 'telefone';
                    identifierValue = row.telefone;
                    break;
                case 'email':
                    identifierField = 'email';
                    identifierValue = row.email;
                    break;
                default:
                    errors.push(`Canal de campanha inválido: ${campaign.channel}`);
                    return;
            }

            if (!row.nome || !identifierValue) {
                errors.push(`Linha ${rowCount} com dados incompletos (nome ou ${identifierField} faltando)`);
                return;
            }
            
            let contact = {
                name: row.nome.trim(),
                company: row.empresa?.trim() || '',
                position: row.cargo?.trim() || '',
                segment: row.segmento?.trim() || '',
                city: row.cidade?.trim() || '',
                notes: row.observacoes?.trim() || ''
            };
            
            if (campaign.channel === 'whatsapp' || campaign.channel === 'whatsapp_official') {
                let phone = String(row.telefone).replace(/\D/g, '');
                if (!phone.startsWith('55')) phone = '55' + phone; 
                if (phone.length < 12 || phone.length > 13) { 
                    errors.push(`Telefone inválido na linha ${rowCount}: ${row.telefone}`);
                    return;
                }
                contact.phone = phone;
            } else if (campaign.channel === 'email') {
                const email = row.email.trim().toLowerCase();
                if (!/^\S+@\S+\.\S+$/.test(email)) {
                    errors.push(`Email inválido na linha ${rowCount}: ${row.email}`);
                    return;
                }
                contact.email = email;
            }
            
            contacts.push(contact);
          })
          .on('end', async () => {
            try {
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
                totalErrors: errors.length
              });
            } catch (saveError) {
              logger.error('Erro ao salvar contatos da campanha:', saveError);
              if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
              res.status(500).json({ message: 'Erro ao processar contatos' });
            }
          })
          .on('error', (streamError) => {
            logger.error('Erro de leitura do CSV:', streamError);
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            res.status(500).json({ message: 'Erro ao ler o arquivo CSV.' });
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
          contactNames
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