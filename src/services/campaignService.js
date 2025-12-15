const Campaign = require('../models/Campaign');
const Lead = require('../models/Lead');
// const Conversation = require('../models/Conversation'); // Não estava sendo usado
const WhatsAppInstance = require('../models/WhatsAppInstance');
const User = require('../models/User');
const evolutionApiService = require('./evolutionApiService');
const zapiService = require('./zapiService');
const emailService = require('./emailService');
// const whatsappService = require('./whatsappService'); // <-- REMOVIDO (Não é mais usado aqui)
const logger = require('../utils/logger');

class CampaignService {
  constructor() {
    this.activeCampaigns = new Map(); // Para controlar campanhas ativas
  }

  // Processar campanha (método principal)
  async processCampaign(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId)
        .populate('whatsappInstance')
        .populate('messageTemplate');
      
      if (!campaign || campaign.status !== 'running') {
        logger.warn('Campanha não encontrada ou não está rodando:', { campaignId });
        return;
      }
      
      // Validação de template para canais que dependem dele
      if (campaign.channel === 'email' && !campaign.messageTemplate) {
          logger.error(`Template de mensagem não encontrado para a campanha de Email ${campaignId}. Pausando campanha.`);
          await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' });
          return;
      }
      
      // (Validação para 'whatsapp' não-oficial pode ser necessária se 'messageTemplate' for o texto)
      if (campaign.channel === 'whatsapp' && !campaign.messageTemplate) {
          logger.error(`Template (texto) não encontrado para a campanha de WhatsApp ${campaignId}. Pausando campanha.`);
          await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' });
          return;
      }


      if (this.activeCampaigns.has(campaignId)) {
        logger.warn('Campanha já está sendo processada:', { campaignId });
        return;
      }

      this.activeCampaigns.set(campaignId, true);
      const user = await User.findById(campaign.user);
      if (!user) {
        logger.error(`Usuário não encontrado para a campanha ${campaignId}`);
        this.activeCampaigns.delete(campaignId);
        return;
      }
      
      const userSettings = user.settings;
      const pendingContacts = campaign.contacts.filter(c => c.status === 'pending');
      
      logger.info('Processando campanha (Loop):', {
        campaignId,
        channel: campaign.channel,
        pendingContacts: pendingContacts.length,
      });

      for (const contact of pendingContacts) {
        const currentCampaign = await Campaign.findById(campaignId);
        if (!currentCampaign || currentCampaign.status !== 'running') {
          logger.info('Campanha parada durante execução:', { campaignId });
          break;
        }

        const todaySent = await this.getTodayMessageCount(campaignId);
        if (todaySent >= campaign.dailyLimit) {
          logger.info('Limite diário atingido, pausando campanha:', { campaignId });
          await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' });
          break;
        }

        try {
          let result;
          
          // ==========================================================
          //  ✅ CASE 'whatsapp_official' REMOVIDO
          //  O CampaignController agora cuida disso (MM Lite)
          // ==========================================================
          switch (campaign.channel) {
            case 'whatsapp':
            case 'email':
              let templateBody = '';
              
              if (campaign.channel === 'email') {
                // Para email, o template é um objeto
                templateBody = campaign.messageTemplate.components.find(c => c.type === 'BODY')?.text || '';
              } else {
                templateBody = campaign.messageTemplate?.components?.find(c => c.type === 'BODY')?.text || '';
                
                // Se for whatsapp não-oficial, e 'messageTemplate' for só o texto:
                if (campaign.channel === 'whatsapp' && typeof campaign.messageTemplate === 'string') {
                    // Se o frontend salvou o *texto* no campo 'messageTemplate'
                    // (o que é provável, já que não há seletor de template para 'whatsapp' não-oficial)
                    templateBody = campaign.messageTemplate;
                }
              }

              const personalizedMessage = this.personalizeMessage(templateBody, contact);
              
              if (campaign.channel === 'email') {
                const personalizedSubject = this.personalizeMessage(campaign.emailSubject || campaign.name, contact);
                const htmlMessage = personalizedMessage.replace(/\n/g, '<br>');
                result = await emailService.sendEmail({ to: contact.email, subject: personalizedSubject, html: htmlMessage }, user.settings);
              } else { // 'whatsapp' (não-oficial)
                  const provider = userSettings?.integrations?.whatsappProvider || 'evolution';
                  if (provider === 'evolution' && userSettings.integrations?.evolutionApi?.enabled) {
                      // Assumindo que 'campaign.whatsappInstance' é o ID da instância do Evolution
                      result = await evolutionApiService.sendMessage(campaign.whatsappInstance, contact.phone, personalizedMessage);
                  } else if (provider === 'zapi' && userSettings.integrations?.zapi?.enabled) {
                      const { instanceId, token } = userSettings.integrations.zapi;
                      result = await zapiService.sendMessage(instanceId, token, contact.phone, personalizedMessage);
                  } else {
                      throw new Error('Nenhum provedor de WhatsApp (não-oficial) ativo ou configurado.');
                  }
              }
              break;

            default:
              throw new Error(`Canal de campanha não suportado: ${campaign.channel}`);
          }

          const contactIndex = campaign.contacts.findIndex(c => c._id.equals(contact._id));
          if (contactIndex !== -1) {
            campaign.contacts[contactIndex].status = 'sent';
            campaign.contacts[contactIndex].sentAt = new Date();
            campaign.contacts[contactIndex].messageId = result.messages?.[0]?.id || result.key?.id || result.messageId || 'sent';
          }
          
          await this.createOrUpdateLead(contact, campaign.user, campaign.channel);

          logger.info('Mensagem de campanha enviada:', {
            campaignId,
            channel: campaign.channel,
            to: contact.phone || contact.email,
          });

        } catch (sendError) {
          logger.error('Erro ao enviar mensagem de campanha:', {
            campaignId,
            contactId: contact._id,
            error: sendError.message
          });

          const contactIndex = campaign.contacts.findIndex(c => c._id.equals(contact._id));
          if (contactIndex !== -1) {
            campaign.contacts[contactIndex].status = 'failed';
            campaign.contacts[contactIndex].failureReason = sendError.message;
          }
        }

        await campaign.save();
        await campaign.updateStats();

        if (campaign.delayBetweenMessages > 0) {
          await new Promise(resolve => setTimeout(resolve, campaign.delayBetweenMessages * 1000));
        }
      }

      const updatedCampaign = await Campaign.findById(campaignId);
      const remainingContacts = updatedCampaign.contacts.filter(c => c.status === 'pending');
      
      if (remainingContacts.length === 0 && updatedCampaign.status === 'running') {
        updatedCampaign.status = 'completed';
        updatedCampaign.completedAt = new Date();
        await updatedCampaign.save();
        logger.info('Campanha completada:', { campaignId });
      }

      this.activeCampaigns.delete(campaignId);

    } catch (error) {
      logger.error('Erro ao processar campanha:', { campaignId, error: error.message });
      await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' });
      this.activeCampaigns.delete(campaignId);
    }
  }

  // ==========================================================
  //  ✅ FUNÇÃO 'buildTemplateComponents' REMOVIDA
  // ==========================================================

  
  // Função mantida para canais que usam o texto completo (email, whatsapp não-oficial)
  personalizeMessage(template, contact) {
    let message = template || '';
    // CORREÇÃO: Regex para {{variavel}} em vez de {variavel} (como no seu CSV)
    message = message.replace(/\{\{nome\}\}/g, contact.name || '');
    message = message.replace(/\{\{empresa\}\}/g, contact.company || '');
    message = message.replace(/\{\{cargo\}\}/g, contact.position || '');
    message = message.replace(/\{\{segmento\}\}/g, contact.segment || '');
    message = message.replace(/\{\{cidade\}\}/g, contact.city || '');
    // Adiciona substituição genérica para outras variáveis (ex: {{1}}, {{variavel}})
    message = message.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        // Se 'key' for um número (como {{1}}), não vai funcionar 
        // pois 'contact' não tem '1' como chave.
        // A lógica de personalização do MM Lite não se aplica aqui.
        // Vamos assumir que os CSVs de E-mail/Não-Oficial usam {{nome}}, etc.
        return contact[key] || '';
    });
    return message.trim();
  }

  // Verificar horário de funcionamento
  isWorkingTime(workingHours, workingDays) {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.toTimeString().slice(0, 5);

    if (!workingDays.includes(currentDay)) return false;
    return currentTime >= workingHours.start && currentTime <= workingHours.end;
  }

  // Contar mensagens enviadas hoje
  async getTodayMessageCount(campaignId) {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return campaign.contacts.filter(contact => 
      contact.sentAt && contact.sentAt >= today
    ).length;
  }

  async createOrUpdateLead(contact, userId, channel) {
    try {
      let lead;
      const query = { user: userId };
      
      if ((channel === 'whatsapp' || channel === 'whatsapp_official') && contact.phone) {
        query.phone = { $regex: contact.phone.slice(-8), $options: 'i' };
      } else if (channel === 'email' && contact.email) {
        query.email = contact.email.toLowerCase();
      } else {
        return null;
      }

      lead = await Lead.findOne(query);

      if (!lead) {
        const leadData = {
          name: contact.name,
          company: contact.company || 'Não informado',
          position: contact.position || '',
          source: `${channel}_campaign`,
          user: userId,
          notes: `Lead criado via campanha ${channel} - ${contact.notes || ''}`
        };

        if (channel.startsWith('whatsapp')) {
          leadData.phone = contact.phone;
        } else if (channel === 'email') {
          leadData.email = contact.email;
        }
        
        lead = new Lead(leadData);
        await lead.save();
        logger.info('Lead criado via campanha:', { leadId: lead._id });
      }
      return lead;
    } catch (error) {
      logger.error('Erro ao criar/atualizar lead de campanha:', error);
      return null;
    }
  }

  async stopCampaign(campaignId) {
    this.activeCampaigns.delete(campaignId);
    logger.info('Campanha marcada para parar:', { campaignId });
  }

  isCampaignActive(campaignId) {
    return this.activeCampaigns.has(campaignId);
  }
}

module.exports = new CampaignService();