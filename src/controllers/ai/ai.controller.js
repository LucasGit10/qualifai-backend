const { getModel } = require('../../utils/modelProvider');
const Lead = getModel('Lead');
const Conversation = getModel('Conversation');
const User = getModel('User');
const aiService = require('../../services/aiService');
const hubspotService = require('../../services/hubspotService');
const pipedriveService = require('../../services/pipedriveService');
const salesforceService = require('../../services/salesforceService');
const rdstationService = require('../../services/rdstationService');
const pipefyService = require('../../services/pipefyService');
const zohoService = require('../../services/zohoService');
const kommoService = require('../../services/kommoService');
const emailService = require('../../services/emailService');
const logger = require('../../utils/logger');
const whatsappService = require('../../services/whatsappService');
const WhatsappInstance = getModel('WhatsAppInstance');
const evolutionApiService = require('../../services/evolutionApiService');
const zapiService = require('../../services/zapiService');
const MessageTemplate = getModel('MessageTemplate');

const syncWithEnabledIntegrations = async (lead, conversation, user) => {
    const integrations = [
        { name: 'hubspot', sync: lead.syncWithHubspot, createDeal: hubspotService.createHubSpotDeal, createNote: hubspotService.createHubSpotNote },
        { name: 'pipedrive', sync: lead.syncWithPipedrive, createDeal: pipedriveService.createPipedriveDeal, createNote: pipedriveService.createPipedriveNote },
        { name: 'salesforce', sync: lead.syncWithSalesforce, createDeal: salesforceService.createSalesforceOpportunity, createNote: null },
        { name: 'rdstation', sync: lead.syncWithRDStation, createDeal: rdstationService.createRDStationConversionEvent, createNote: null },
        { name: 'pipefy', sync: lead.syncWithPipefy, createDeal: null, createNote: null },
        { name: 'zoho', sync: lead.syncWithZoho, createDeal: zohoService.convertZohoLead, createNote: null },
        { name: 'kommo', sync: lead.syncWithKommo, createDeal: kommoService.createKommoDeal, createNote: kommoService.createKommoNote }
    ];

    for (const integration of integrations) {
        if (user.settings?.integrations?.[integration.name]?.enabled) {
            try {
                logger.info(`🔄 ${integration.name}: Sincronizando lead...`);
                await integration.sync.call(lead, user.settings);
                logger.info(`✅ ${integration.name}: Lead sincronizado`);

                if (lead.status === 'qualificado' || lead.status === 'convertido') {
                    if (integration.createDeal) {
                        const dealResult = await integration.createDeal(lead, user.settings);
                        if (dealResult && dealResult.dealId) {
                            lead[integration.name].dealId = dealResult.dealId;
                            await lead.save();
                        }
                        logger.info(`✅ ${integration.name}: Deal/Oportunidade/Evento criado`);
                    }
                    if (integration.createNote) {
                        await integration.createNote(lead, conversation, user.settings);
                        logger.info(`✅ ${integration.name}: Nota da conversa criada`);
                    }
                }
            } catch (error) {
                logger.error(`❌ Erro na integração ${integration.name}:`, error);
            }
        }
    }
};

// Função auxiliar para construir o payload de componentes do template
const buildTemplateComponents = (template, lead) => {
  const components = [];

  template.components.forEach(component => {
    const componentPayload = { type: component.type.toLowerCase() };
    const parameters = [];

    let textWithVars = component.text;
    if (textWithVars) {
        // Esta lógica assume que as variáveis no template são {{1}} para nome e {{2}} para empresa.
        // Adapte conforme a necessidade se tiver mais variáveis.
        if (textWithVars.includes('{{1}}')) {
            parameters.push({ type: 'text', text: lead.name || 'Cliente' });
        }
        if (textWithVars.includes('{{2}}')) {
            parameters.push({ type: 'text', text: lead.company || 'sua empresa' });
        }
        // Adicionar mais 'if' para {{3}}, {{4}}, etc., se necessário.

        if (parameters.length > 0) {
          componentPayload.parameters = parameters;
          components.push(componentPayload);
        }
    }
  });

  return components;
};

class AIController {
  // Iniciar conversa automática com lead - VERSÃO CORRIGIDA
  startConversation = async (req, res) => {
    try {
      const { leadId, channel, instanceId, templateId } = req.body;
      const userId = req.user.id;

      if (channel === 'whatsapp' && (!instanceId || !templateId)) {
        return res.status(400).json({ message: 'O ID da instância e do template são obrigatórios.' });
      }

      const lead = await Lead.findOne({ _id: leadId, user: userId });
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado' });

      const existingConversation = await Conversation.findOne({ lead: leadId, channel: channel, user: userId, status: 'active' });
      if (existingConversation) {
        return res.status(409).json({ message: `Já existe uma conversa ativa para o lead '${lead.name}'.`, conversationId: existingConversation._id });
      }

      const activeInstance = await WhatsappInstance.findOne({ _id: instanceId, user: userId, status: 'connected' });
      if (!activeInstance) return res.status(404).json({ message: 'Instância do WhatsApp não encontrada ou não conectada.' });
      
      const messageTemplate = await MessageTemplate.findOne({ _id: templateId, user: userId, status: 'approved' });
      if (!messageTemplate) return res.status(404).json({ message: 'Template não encontrado ou não aprovado.' });

      const components = buildTemplateComponents(messageTemplate, lead);
      
      const user = await User.findById(userId);
      const conversation = new Conversation({
        lead: leadId,
        channel,
        user: userId,
        instance: activeInstance._id,
        messages: [{ role: 'ai', content: `Template "${messageTemplate.name}" enviado.`, channel }]
      });
      await conversation.save();

      lead.status = 'contatado';
      lead.lastContact = new Date();
      await lead.save();

      await this.sendMessageToChannel(
        lead,
        {
          type: 'template',
          templateName: messageTemplate.name,
          templateLanguage: messageTemplate.language, // Enviando o idioma do template
          components: components,
          content: `Template "${messageTemplate.name}" enviado.`,
        },
        channel,
        user.settings,
        activeInstance
      );
      
      req.app.get('io').to(`user-${userId}`).emit('new_conversation', { conversation, lead });
      res.json({ success: true, conversation });
    } catch (error) {
      logger.error('Erro ao iniciar conversa:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Processar resposta do lead (sem alterações)
  processLeadResponse = async (req, res) => {
    try {
        const { conversationId, message, channel } = req.body;
        const userId = req.user.id;

        const conversation = await Conversation.findOne({ _id: conversationId, user: userId }).populate('lead').populate('instance');
        if (!conversation) {
            return res.status(404).json({ message: 'Conversa não encontrada' });
        }

        const lead = conversation.lead;
        if (!lead) {
            return res.status(404).json({ message: 'Lead associado não encontrado' });
        }
        
        const messageToPush = { role: 'lead', content: message, channel };
        if (req.body.audioUrl) {
            messageToPush.metadata = { audioUrl: req.body.audioUrl };
        }
        conversation.messages.push(messageToPush);
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
        conversation.lastMessageAt = new Date();
        conversation.lastInboundMessageAt = new Date();
        await conversation.save();
        req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });

        if (conversation.aiEnabled === false) {
            return res.json({ success: true, conversation, aiResponse: null, message: "IA desativada." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado' });
        }
        
        const instance = channel === 'whatsapp' ? conversation.instance : null;

        const needsHuman = await aiService.detectHumanHandoffRequest(message);

        if (needsHuman && conversation.aiEnabled) {
            logger.info(`[Handoff] Lead ${lead._id} solicitou especialista. Escalando...`);

            conversation.handedOffToHuman = true;
            conversation.handedOffAt = new Date();
            conversation.status = 'escalated';
            conversation.aiEnabled = false;

            conversation.messages.push({
                role: 'system',
                content: 'O lead solicitou falar com um especialista. A IA foi desativada.',
                channel: conversation.channel,
            });

            const finalAiResponse = "Entendido. Um de nossos especialistas entrará em contato em breve para ajudar.";
            conversation.messages.push({ role: 'ai', content: finalAiResponse, channel });
            conversation.sentCount = (conversation.sentCount || 0) + 1;
            conversation.lastMessageAt = new Date();
            conversation.lastOutboundMessageAt = new Date();

            await conversation.save();
            
            if (user.settings?.aiConfig?.enableVoiceInteraction) {
                const audioBuffer = await aiService.textToSpeech(finalAiResponse, user.settings.aiConfig.voiceModel);
                await this.sendMessageToChannel(lead, { type: 'audio', buffer: audioBuffer, content: finalAiResponse }, channel, user.settings, instance);
            } else {
                await this.sendMessageToChannel(lead, { type: 'text', content: finalAiResponse }, channel, user.settings, instance);
            }
            
            req.app.get('io').to(`user-${userId}`).emit('conversation_escalated', { conversation });

            return res.json({ success: true, conversation, aiResponse: finalAiResponse });
        }


        let aiResponse;
        logger.info(`🤖 Processando resposta do lead ${lead._id} no canal ${channel}:`, message);
        
        if (conversation.schedulingAttempt?.status === 'proposed') {
            const schedulingResult = await aiService.parseLeadSchedulingResponse(conversation, message);
            logger.info(`[Scheduling] Resultado do agendamento para o lead ${lead._id}:`, schedulingResult);
            
            if (schedulingResult.status === 'CONFIRMED' && schedulingResult.dateTime) {
                const meetingTime = new Date(schedulingResult.dateTime);
                
                const { localEvent, googleMeetLink, googleCalendarSimulated, googleCalendarError } = await aiService.createMeetingInCRMs(user, lead, meetingTime);

                conversation.schedulingAttempt.status = 'confirmed';
                conversation.schedulingAttempt.scheduledEventId = localEvent._id.toString();

                if (googleCalendarSimulated) {
                    const systemMessage = googleCalendarError
                        ? `[SISTEMA] Falha ao criar evento no Google Calendar: ${googleCalendarError}. O evento foi criado apenas no sistema local.`
                        : `[SISTEMA] Atenção: O evento no Google Calendar foi simulado. Verifique se a integração com o Google Calendar está configurada corretamente.`;
                    
                    conversation.messages.push({
                        role: 'system',
                        content: systemMessage,
                        channel: conversation.channel,
                    });
                }

                const formattedDate = meetingTime.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
                
                const hasValidEmail = lead.email && !lead.email.includes('@whatsapp.qualifai') && !lead.email.includes('@whatsapp.campaign');
                
                let confirmationMessage = hasValidEmail
                    ? "Você receberá um convite por e-mail em breve."
                    : "O agendamento foi confirmado em nosso sistema.";
                
                if (googleCalendarSimulated && hasValidEmail) {
                    confirmationMessage += " (Atenção: Pode haver um atraso no envio do convite por e-mail.)";
                }
                
                let meetLinkMessage = googleMeetLink
                    ? ` O link para nossa conversa é: ${googleMeetLink}`
                    : '';

                aiResponse = `Excelente! Reunião agendada para ${formattedDate}.${meetLinkMessage} ${confirmationMessage} Algo mais em que posso ajudar?`;


            } else {
                if (!['NEGOTIATING', 'UNCLEAR', 'REJECTED'].includes(schedulingResult.status)) {
                    logger.warn(`[Scheduling] Status inesperado do parse: ${schedulingResult.status}. Tratando como 'negotiating'.`);
                }
                conversation.schedulingAttempt.status = 'negotiating';
                conversation.schedulingAttempt.proposedTimes = []; // Clear old suggestions
                aiResponse = await aiService.generateResponse(conversation, lead, user.settings);
            }
        } else {
            aiResponse = await aiService.generateResponse(conversation, lead, user.settings);
            
            // Lógica de classificação de prioridade de cobrança
            if (['novo', 'contatado', 'morno', 'frio'].includes(lead.status)) {
                const classification = await aiService.classifyLead(conversation, lead, user.settings);
                
                if (classification === 'quente') {
                    lead.status = 'em_negociacao';

                    try {
                        logger.info(`[Scheduling] Iniciando agendamento para o devedor em negociação ${lead._id}...`);
                        const availableSlots = await aiService.getAvailableSlots(user);

                        if (availableSlots.length > 0) {
                            aiResponse = await aiService.generateSchedulingProposal(conversation, lead, user.settings, availableSlots);
                            logger.info(`[Scheduling] Horários disponíveis para o devedor ${lead._id}:`, availableSlots);
                            conversation.schedulingAttempt = {
                                status: 'proposed',
                                proposedTimes: availableSlots,
                            };
                        } else {
                            logger.warn(`[Scheduling] Sem horários disponíveis para agendamento com o devedor ${lead._id}.`);
                        }
                    } catch (scheduleError) {
                        logger.error(`[Scheduling] Erro ao buscar horários para o devedor ${lead._id}:`, scheduleError);
                    }

                } else {
                    // Para morno ou frio, marcamos como contatado se ainda estiver no início
                    if (lead.status === 'novo') lead.status = 'contatado';
                }
                
                await lead.save();
                await syncWithEnabledIntegrations(lead, conversation, user);
            }
        }

        conversation.messages.push({ role: 'ai', content: aiResponse, channel });
        conversation.sentCount = (conversation.sentCount || 0) + 1;
        conversation.lastMessageAt = new Date();
        conversation.lastOutboundMessageAt = new Date();
        await conversation.save();

        if (user.settings?.aiConfig?.enableVoiceInteraction) {
            try {
              logger.info(`🎤 Convertendo resposta para voz [${user.settings.aiConfig.voiceModel}]...`);
              const audioBuffer = await aiService.textToSpeech(aiResponse, user.settings.aiConfig.voiceModel);
              await this.sendMessageToChannel(lead, { type: 'audio', buffer: audioBuffer, content: aiResponse }, channel, user.settings, instance);
            } catch (ttsError) {
              logger.error('❌ Erro no TTS, enviando como texto:', ttsError);
              await this.sendMessageToChannel(lead, { type: 'text', content: aiResponse }, channel, user.settings, instance);
            }
        } else {
            await this.sendMessageToChannel(lead, { type: 'text', content: aiResponse }, channel, user.settings, instance);
        }
        
        req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });

        res.json({ success: true, conversation, aiResponse });

    } catch (error) {
        logger.error('❌ Erro ao processar resposta do lead:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Escalar para humano (sem alterações)
  async escalateToHuman(req, res) {
    try {
      const { conversationId } = req.body;
      const userId = req.user.id;

      const conversation = await Conversation.findOneAndUpdate(
        { _id: conversationId, user: userId },
        { 
          handedOffToHuman: true, 
          handedOffAt: new Date(),
          status: 'escalated',
          aiEnabled: false,
          $push: { messages: { role: 'system', content: 'A conversa foi escalada para um especialista manualmente.', channel: 'chat' } }
        },
        { new: true }
      ).populate('lead');

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      const user = await User.findById(userId);
      if(user.settings.integrations?.hubspot?.enabled) await hubspotService.createHubSpotTask(conversation.lead, userId, user.settings);
      
      req.app.get('io').to(`user-${userId}`).emit('conversation_escalated', { conversation });

      res.json({ success: true, conversation });
    } catch (error) {
      logger.error('Erro ao escalar para humano:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Gerar template de campanha com IA (sem alterações)
  async generateTemplate(req, res) {
    try {
        const { name, description, channel } = req.body;
        
        const template = await aiService.generateCampaignTemplate({ name, description, channel });

        res.json({ success: true, template });
    } catch (error) {
        logger.error('Erro ao gerar template:', error);
        res.status(500).json({ message: 'Erro interno do servidor ao gerar template.' });
    }
  }

  // Método auxiliar para enviar mensagens pelos canais - VERSÃO CORRIGIDA
  async sendMessageToChannel(lead, messagePayload, channel, userSettings, instance = null) {
    try {
      switch (channel) {
        case 'whatsapp':
          if (!lead.phone) {
            logger.warn(`⚠️ Telefone ausente para envio via WhatsApp. Lead: ${lead._id}`);
            return;
          }
          const provider = userSettings?.integrations?.whatsappProvider || 'whatsapp';

          if (provider === 'whatsapp') {
            if (!instance) {
              logger.warn(`⚠️ Instância do WhatsApp (Meta) ausente para o lead ${lead._id}. Mensagem não enviada.`);
              return;
            }
            
            if (messagePayload.type === 'template') {
              await whatsappService.sendTemplateMessage(
                instance,
                lead.phone,
                messagePayload.templateName,
                messagePayload.templateLanguage, // Passando o idioma
                messagePayload.components
              );
            } else if (messagePayload.type === 'audio') {
              const mediaId = await whatsappService.uploadMedia(instance, messagePayload.buffer, 'audio/ogg');
              await whatsappService.sendAudioMessage(instance, lead.phone, mediaId);
            } else {
              await whatsappService.sendTextMessage(instance, lead.phone, messagePayload.content);
            }
          } else if (provider === 'zapi') {
            const zapiConfig = userSettings.integrations.zapi;
            if (!zapiConfig?.enabled || !zapiConfig.instanceId || !zapiConfig.token) {
              logger.warn(`⚠️ Z-API não configurada ou desativada para o usuário.${zapiConfig.instanceId} ${zapiConfig.token}`);
              return;
            }
            if (messagePayload.type === 'audio') {
              await zapiService.sendAudioMessage(zapiConfig.instanceId, zapiConfig.token, lead.phone, messagePayload.buffer);
            } else {
              await zapiService.sendMessage(zapiConfig.instanceId, zapiConfig.token, lead.phone, messagePayload.content);
            }
          }
          break;
        case 'email':
          if (lead.email) await emailService.sendEmail({ to: lead.email, subject: 'Resposta da QualifAI', html: messagePayload.content }, userSettings);
          break;
        case 'chat':
          break;
        default:
          logger.warn(`⚠️ Canal não suportado para envio: ${channel}`);
      }
    } catch (error) {
      logger.error(`❌ Erro ao enviar mensagem via ${channel}:`, error);
      throw error;
    }
  }

  // Iniciar múltiplas conversas - VERSÃO CORRIGIDA
  startMultipleConversations = async (req, res) => {
    try {
        const { leadIds, channel, instanceId, templateId } = req.body;
        const userId = req.user.id;
        
        if (channel === 'whatsapp' && (!instanceId || !templateId)) {
          return res.status(400).json({ message: 'Para disparo em massa no WhatsApp, o ID da instância e do template são obrigatórios.' });
        }

        const user = await User.findById(userId);
        const activeInstance = await WhatsappInstance.findOne({ _id: instanceId, user: userId, status: 'connected' });
        if (!activeInstance) return res.status(404).json({ message: 'Instância do WhatsApp não encontrada ou não conectada.' });
        
        const messageTemplate = await MessageTemplate.findOne({ _id: templateId, user: userId, status: 'approved' });
        if (!messageTemplate) return res.status(404).json({ message: 'Template não encontrado ou não aprovado.' });

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        const conversationPromises = leadIds.map(async (leadId) => {
            try {
                const lead = await Lead.findOne({ _id: leadId, user: userId });
                if (!lead) {
                    return { status: 'error', reason: `Lead ${leadId} não encontrado.` };
                }

                const existingConversation = await Conversation.findOne({ lead: leadId, channel, user: userId, status: 'active' });
                if (existingConversation) {
                    return { status: 'error', reason: `Lead ${lead.name} já possui uma conversa ativa.` };
                }

                const components = buildTemplateComponents(messageTemplate, lead);

                const conversation = new Conversation({
                    lead: leadId,
                    channel,
                    user: userId,
                    instance: activeInstance._id,
                    messages: [{ role: 'ai', content: `Template "${messageTemplate.name}" enviado.`, channel }]
                });
                await conversation.save();

                lead.status = 'contatado';
                lead.lastContact = new Date();
                await lead.save();

                await this.sendMessageToChannel(
                  lead, 
                  { 
                    type: 'template', 
                    templateName: messageTemplate.name,
                    templateLanguage: messageTemplate.language, // Enviando o idioma
                    components 
                  },
                  channel, 
                  user.settings, 
                  activeInstance
                );

                req.app.get('io').to(`user-${userId}`).emit('new_conversation', { conversation, lead });
                return { status: 'success' };
            } catch (error) {
                logger.error(`Erro ao iniciar conversa para o lead ${leadId}:`, error);
                return { status: 'error', reason: `Erro para lead ${leadId}: ${error.message}` };
            }
        });

        const results = await Promise.all(conversationPromises);
        results.forEach(result => {
          if (result.status === 'success') {
            successCount++;
          } else {
            errorCount++;
            errors.push(result.reason);
          }
        });

        res.json({
            success: true,
            message: 'Processamento de múltiplas conversas concluído.',
            successCount,
            errorCount,
            errors
        });
    } catch (error) {
        logger.error('Erro geral ao iniciar múltiplas conversas:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  getSpeechSample = async (req, res) => {
    try {
      const { voice } = req.body;
      if (!voice) {
        return res.status(400).json({ message: 'A voz é obrigatória.' });
      }
      const audioBuffer = await aiService.generateSpeechSample(voice);
      res.set('Content-Type', 'audio/opus');
      res.send(audioBuffer);
    } catch (error) {
      res.status(500).json({ message: 'Erro ao gerar amostra de áudio.' });
    }
  };
}

module.exports = new AIController();
