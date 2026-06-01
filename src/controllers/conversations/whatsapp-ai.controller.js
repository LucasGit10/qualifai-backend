const { getModel } = require('../../utils/modelProvider');
const Lead = getModel('Lead');
const Conversation = getModel('Conversation');
const User = getModel('User');
const WhatsAppInstance = getModel('WhatsAppInstance');
const MessageTemplate = getModel('MessageTemplate');
const TeamMember = getModel('TeamMember');
const aiService = require('../../services/aiService');
const whatsappService = require('../../services/whatsappService');
const oneSignalService = require('../../services/oneSignalService');
const negotiationIntelligenceService = require('../../services/negotiationIntelligenceService');
const { findReusableConversation, touchOutboundConversation } = require('../../services/conversationReuseService');
const logger = require('../../utils/logger');
const mongoose = require('mongoose');

const isAiUnavailableResult = (result) =>
  result?.aiUnavailable === true || result?.action === 'disable_ai';

const disableAiWithoutReply = (conversation, channel, errorDetail) => {
    conversation.aiEnabled = false;
    conversation.messages.push({
        role: 'system',
        content: `⚠️ FALHA TÉCNICA NA IA: ${errorDetail || 'Erro interno no processamento'}. A automação foi desativada por segurança.`,
        channel,
    });
};

const resolveConversationOwner = async (userId, { conversationOwnerType, teamMemberId } = {}) => {
  if (conversationOwnerType === 'teamMember' || teamMemberId) {
    if (!teamMemberId) {
      const error = new Error('Selecione o perfil que vai iniciar a conversa.');
      error.statusCode = 400;
      throw error;
    }
    if (!mongoose.Types.ObjectId.isValid(teamMemberId)) {
      const error = new Error('Perfil de atendimento invalido.');
      error.statusCode = 400;
      throw error;
    }

    const teamMember = await TeamMember.findOne({ _id: teamMemberId, owner: userId, isActive: true });
    if (!teamMember) {
      const error = new Error('Perfil de atendimento nao encontrado ou inativo.');
      error.statusCode = 404;
      throw error;
    }

    return {
      conversationOwnerType: 'teamMember',
      assignedTeamMember: teamMember._id
    };
  }

  return {
    conversationOwnerType: 'master',
    assignedTeamMember: null
  };
};

const buildTemplateComponents = (template, lead, mediaUrl = null, userSettings = {}) => {
  const components = [];

  (template.components || []).forEach(component => {
    if (!component?.type) return;
    const componentType = component.type.toLowerCase();
    
    // 1. Tratamento de Cabeçalho de Mídia (Imagem, Vídeo, Documento)
    if (componentType === 'header' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(component.format)) {
      if (mediaUrl) {
        const mediaType = component.format.toLowerCase();
        components.push({
          type: 'header',
          parameters: [
            {
              type: mediaType,
              [mediaType]: { link: mediaUrl }
            }
          ]
        });
      }
      return;
    }

    // 2. Tratamento de Variáveis de Texto em BODY e HEADER
    if (!['body', 'header'].includes(componentType)) return;

    const parameters = [];
    const variableRegex = /\{\{([0-9]+)\}\}/g;
    const textWithVars = component.text;

    if (textWithVars) {
      const matches = textWithVars.match(variableRegex);
      if (matches) {
        const uniqueVars = [...new Set(matches)]
          .map(m => parseInt(m.replace(/\{\{|\}\}/g, '')))
          .sort((a, b) => a - b);

        uniqueVars.forEach(varNum => {
          let value = '';
          if (varNum === 1) {
            value = lead.name || 'Cliente';
          } else if (varNum === 2) {
            // Usa o nome da empresa do usuário (credor) em vez da empresa do devedor
            value = userSettings?.company?.name || userSettings?.settings?.company?.name || 'QualifAI';
          } else {
            value = `Dado_${varNum}`;
          }
          parameters.push({ type: 'text', text: value });
        });
      }
    }

    if (parameters.length > 0) {
      let existingComp = components.find(c => c.type === componentType);
      if (existingComp) {
        existingComp.parameters = [...existingComp.parameters, ...parameters];
      } else {
        components.push({
          type: componentType,
          parameters: parameters
        });
      }
    }
  });

  return components;
};

class WhatsAppAIController {

  // _sendMessageHelper (Mantido 100% - Sem alterações)
  async _sendMessageHelper(lead, messagePayload, instance, userSettings) {
    try {
      if (!lead.phone) {
        logger.warn(`⚠️ [Meta API] Telefone ausente para o lead: ${lead._id}.`);
        return;
      }
      if (!instance) {
        logger.warn(`⚠️ [Meta API] Instância ausente para o lead ${lead._id}.`);
        return;
      }

      if (messagePayload.type === 'template') {
        await whatsappService.sendTemplateMessage(
          instance,
          lead.phone,
          messagePayload.templateName,
          messagePayload.languageCode,
          messagePayload.components
        );
      } else if (messagePayload.type === 'audio' && userSettings?.aiConfig?.enableVoiceInteraction) {
        logger.info(`🎤 [Meta API] Convertendo resposta para voz...`);
        const audioBuffer = messagePayload.buffer || await aiService.textToSpeech(messagePayload.content, userSettings.aiConfig.voiceModel);
        const mediaId = await whatsappService.uploadMedia(instance, audioBuffer, 'audio/ogg');
        await whatsappService.sendAudioMessage(instance, lead.phone, mediaId);
      } else {
        await whatsappService.sendTextMessage(instance, lead.phone, messagePayload.content);
      }
    } catch (error) {
      logger.error(`❌ Erro ao enviar mensagem via WhatsApp Oficial para o lead ${lead._id}:`, error);
    }
  }

  // startConversationWithTemplate
  startConversationWithTemplate = async (req, res) => {
    try {
      const { leadId, instanceId, templateId, mediaUrl, imageUrl, conversationOwnerType, teamMemberId } = req.body;
      const userId = req.user.id;

      logger.info(`[/whatsapp-ai/start] STEP 1 - Iniciando. userId=${userId} leadId=${leadId} instanceId=${instanceId} templateId=${templateId}`);

      let finalMediaUrl = mediaUrl || imageUrl;

      if (!leadId || !instanceId || !templateId) {
        return res.status(400).json({ message: 'leadId, instanceId e templateId são obrigatórios.' });
      }

      const lead = await Lead.findOne({ _id: leadId, user: userId });
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado.' });
      logger.info(`[/whatsapp-ai/start] STEP 2 - Lead encontrado: ${lead.name} (${lead._id})`);

      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId, status: 'connected' });
      if (!instance) return res.status(404).json({ message: 'Instância não encontrada ou desconectada.' });
      logger.info(`[/whatsapp-ai/start] STEP 3 - Instância encontrada: ${instance.instanceName}`);

      const template = await MessageTemplate.findOne({ _id: templateId, user: userId, status: 'approved' });
      if (!template) return res.status(404).json({ message: 'Template não encontrado ou não aprovado.' });
      logger.info(`[/whatsapp-ai/start] STEP 4 - Template encontrado: ${template.name}`);

      if (!finalMediaUrl) finalMediaUrl = template.sampleMediaUrl;
      const components = buildTemplateComponents(template, lead, finalMediaUrl, req.user);
      logger.info(`[/whatsapp-ai/start] STEP 5 - Components buildados: ${JSON.stringify(components)}`);

      const ownerFields = await resolveConversationOwner(userId, { conversationOwnerType, teamMemberId });
      logger.info(`[/whatsapp-ai/start] STEP 6 - Owner resolvido: ${JSON.stringify(ownerFields)}`);

      let conversation = await findReusableConversation({ userId, leadId, channel: 'whatsapp' });
      const isNewConversation = !conversation;
      logger.info(`[/whatsapp-ai/start] STEP 7 - findReusableConversation: isNew=${isNewConversation} convId=${conversation?._id}`);

      if (!conversation) {
        conversation = new Conversation({
          lead: leadId,
          channel: 'whatsapp',
          user: userId,
          instance: instanceId,
          ...ownerFields,
          messages: []
        });
      }

      touchOutboundConversation(conversation, {
        channel: 'whatsapp',
        instanceId,
        ownerFields,
        message: {
          role: 'ai',
          content: `Template "${template.name}" enviado.`
        }
      });
      logger.info(`[/whatsapp-ai/start] STEP 8 - touchOutboundConversation OK. Total msgs=${conversation.messages.length}`);

      // Log das mensagens para detectar channel inválido
      const channelsInMessages = conversation.messages.map(m => m.channel);
      logger.info(`[/whatsapp-ai/start] STEP 8.1 - Channels das msgs: ${JSON.stringify(channelsInMessages)}`);

      await conversation.save();
      logger.info(`[/whatsapp-ai/start] STEP 9 - conversation.save() OK. convId=${conversation._id}`);

      lead.status = 'contatado';
      lead.lastContact = new Date();
      await lead.save();
      logger.info(`[/whatsapp-ai/start] STEP 10 - lead.save() OK`);

      await this._sendMessageHelper(lead, {
        type: 'template',
        templateName: template.name,
        languageCode: template.language,
        components: components,
      }, instance, req.user.settings);
      logger.info(`[/whatsapp-ai/start] STEP 11 - _sendMessageHelper OK`);

      req.app.get('io').to(`user-${userId}`).emit(isNewConversation ? 'new_conversation' : 'conversation_updated', { conversation, lead });

      oneSignalService.sendPushNotification(
        userId,
        'Conversa Iniciada',
        `A conversa com ${lead.name || 'o cliente'} foi iniciada pelo template automático.`,
        { type: 'whatsapp', link: `/app/conversations-whats?id=${conversation._id}` }
      );

      logger.info(`[/whatsapp-ai/start] STEP 12 - Sucesso total. convId=${conversation._id}`);
      res.status(200).json({ success: true, message: 'Conversa iniciada com sucesso via template.', conversation });
    } catch (error) {
      logger.error(`[/whatsapp-ai/start] ERRO: name=${error.name} message=${error.message}`);
      logger.error(`[/whatsapp-ai/start] STACK: ${error.stack}`);
      if (error.name === 'ValidationError') {
        logger.error(`[/whatsapp-ai/start] ValidationError details: ${JSON.stringify(error.errors)}`);
      }
      if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
      res.status(500).json({ message: 'Erro interno do servidor', details: error.message });
    }
  }

  processLeadResponse = async (req, res) => {
    try {
        const { conversationId, message } = req.body;
        const userId = req.user.id;
        const channel = 'whatsapp';

        let conversationEnded = false; 

        const conversation = await Conversation.findOne({ _id: conversationId, user: userId }).populate('lead').populate('instance');
        if (!conversation || !conversation.lead || !conversation.instance) {
            return res.status(404).json({ message: 'Conversa, lead ou instância associada não encontrada.' });
        }

        const { lead, instance } = conversation;
        
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
            return res.json({ success: true, conversation, message: "IA desativada, mensagem salva." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado' });
        }
        
        let aiResponse;
        let aiResult = null;

        if (conversation.conversationState === 'SCHEDULING') {
            const schedulingResult = await aiService.parseLeadSchedulingResponse(conversation, message);
            
            if (schedulingResult.status === 'CONFIRMED' && schedulingResult.dateTime) {
                logger.info(`[Scheduling] Lead ${lead._id} confirmou horário: ${schedulingResult.dateTime}`);
                const meetingTime = new Date(schedulingResult.dateTime);
                const { googleMeetLink } = await aiService.createMeetingInCRMs(user, lead, meetingTime);
                
                conversation.schedulingAttempt.status = 'confirmed'; 
                conversation.status = 'closed';
                conversation.endedAt = new Date();
                conversation.conversationState = 'CONVERTED'; 
                
                const formattedDate = meetingTime.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
                let meetLinkMessage = googleMeetLink ? ` O link para nossa conversa é: ${googleMeetLink}` : '';
                aiResponse = `Excelente! Reunião agendada para ${formattedDate}.${meetLinkMessage} Algo mais em que posso ajudar?`;
                
                lead.status = 'qualificado'; 
                conversationEnded = true; 

            } else {
                logger.info(`[Scheduling] Lead ${lead._id} respondeu no estado SCHEDULING, mas não confirmou. Deixando a IA decidir.`);
                aiResult = await aiService.generateResponse(conversation, lead, user);
            }
        }
        
        if (!aiResult && !aiResponse) { 
            aiResult = await aiService.generateResponse(conversation, lead, user);
        }
        
        if (aiResult) {
            if (isAiUnavailableResult(aiResult)) {
                logger.error('[AI WhatsApp] Erro crítico na IA:', aiResult.error);
                disableAiWithoutReply(conversation, channel, aiResult.error);
                await conversation.save();
                req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });
                return res.json({ success: true, conversation, aiResponse: null, message: 'IA desativada por erro técnico.' });
            }

            aiResponse = aiResult.reply;

            if (aiResult.leadStatus) {
                lead.status = aiResult.leadStatus;
            }
            if (aiResult.conversationState) {
                conversation.conversationState = aiResult.conversationState;
            }

            if (aiResult.escalate === true || aiResult.action === 'request_human') {
                logger.info(`[Handoff] Lead ${lead._id} solicitou especialista no WhatsApp. Escalando...`);
                conversation.handedOffToHuman = true;
                conversation.handedOffAt = new Date();
                conversation.status = 'escalated';
                conversation.aiEnabled = false;

                let conversationSummary = '';
                try {
                    conversationSummary = await aiService.summarizeConversation(conversation.messages, lead);
                    logger.info(`[Handoff WhatsApp] Resumo gerado para conversa ${conversation._id}`);
                } catch (summaryError) {
                    logger.error('[Handoff WhatsApp] Erro ao gerar resumo:', summaryError);
                    conversationSummary = 'Não foi possível gerar o resumo automático.';
                }

                conversation.messages.push({
                    role: 'system',
                    content: 'O lead solicitou falar com um especialista. A IA foi desativada.',
                    channel: channel,
                });

                conversation.messages.push({
                    role: 'system',
                    content: `📋 RESUMO DA CONVERSA PARA O ATENDENTE:\n${conversationSummary}`,
                    channel: channel,
                });

                conversationEnded = true; 

                // Notificação via OneSignal
                try {
                    await oneSignalService.sendPushNotification(
                        userId,
                        'Assistência Humana Solicitada',
                        `O lead ${lead.name || lead.phone} solicitou falar com um humano.`,
                        { type: 'whatsapp', link: `/app/conversations-whats?id=${conversation._id}` }
                    );
                } catch (pushError) {
                    logger.error('Erro ao enviar notificação OneSignal:', pushError);
                }
            }
            
            else if (aiResult.endCall === true) {
                logger.info(`[AI Action] IA encerrou a conversa com lead ${lead._id}. Status: ${aiResult.leadStatus}`);
                conversation.status = 'closed';
                conversation.endedAt = new Date();
                conversationEnded = true; 
            }
        }

        if (aiResponse) {
            conversation.messages.push({ role: 'ai', content: aiResponse, channel });
            conversation.sentCount = (conversation.sentCount || 0) + 1;
            conversation.lastMessageAt = new Date();
            conversation.lastOutboundMessageAt = new Date();
        }
        
        await lead.save();
        await conversation.save();
        negotiationIntelligenceService.refreshConversationInBackground({
            conversationId: conversation._id,
            userId,
            io: req.app.get('io'),
        });
        
        if (conversationEnded) {
            logger.info(`[Auto-Treinamento] Conversa ${conversation._id} (WhatsApp) marcada para análise.`);
            aiService._analyzeConversation(conversation, lead)
                .then(analysis => {
                    if (analysis) {
                        aiService._vectorizeAndStore(analysis, conversation._id, lead._id);
                    }
                })
                .catch(err => {
                    logger.error(`[Auto-Treinamento] Falha ao analisar conversa WhatsApp ${conversation._id}:`, err);
                });
        }
        
        if (aiResponse && !conversation.handedOffToHuman) { 
            const messagePayload = { type: 'text', content: aiResponse };
            if (user.settings?.aiConfig?.enableVoiceInteraction) {
                messagePayload.type = 'audio';
                messagePayload.buffer = await aiService.textToSpeech(aiResponse, user.settings.aiConfig.voiceModel);
            }
            await this._sendMessageHelper(lead, messagePayload, instance, user.settings);
        
        } else if (aiResponse && conversation.handedOffToHuman) {
             await this._sendMessageHelper(lead, { type: 'text', content: aiResponse }, instance, user.settings);
        }
        
        if (conversation.handedOffToHuman) {
            req.app.get('io').to(`user-${userId}`).emit('conversation_escalated', { conversation });
        } else {
            req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });
        }
        
        res.json({ success: true, conversation, aiResponse });
    } catch (error) {
        logger.error('Erro ao processar resposta do lead (WhatsApp):', error);
	        if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
	        res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  startMultipleConversationsWithTemplate = async (req, res) => {
    try {
	        const { leadIds, instanceId, templateId, mediaUrl, imageUrl, conversationOwnerType, teamMemberId } = req.body;
        const userId = req.user.id;

        if (!Array.isArray(leadIds) || !instanceId || !templateId) {
            return res.status(400).json({ message: 'leadIds (array), instanceId e templateId são obrigatórios.' });
        }

        const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId, status: 'connected' });
        if (!instance) return res.status(404).json({ message: 'Instância não encontrada ou desconectada.' });

        const template = await MessageTemplate.findOne({ _id: templateId, user: userId, status: 'approved' });
	        const finalMediaUrl = mediaUrl || imageUrl || template?.sampleMediaUrl;
	        const ownerFields = await resolveConversationOwner(userId, { conversationOwnerType, teamMemberId });
        if (!template) return res.status(404).json({ message: 'Template não encontrado ou não aprovado.' });

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const leadId of leadIds) {
            try {
                const lead = await Lead.findOne({ _id: leadId, user: userId });
                if (!lead) {
                    errors.push(`Lead ${leadId} não encontrado.`);
                    errorCount++;
                    continue;
                }
                
                let conversation = await findReusableConversation({ userId, leadId, channel: 'whatsapp' });
                if (!conversation) {
                    conversation = new Conversation({
                        lead: leadId,
                        channel: 'whatsapp',
                        user: userId,
                        instance: instanceId,
                        ...ownerFields,
                        messages: []
                    });
                }
                touchOutboundConversation(conversation, {
                    channel: 'whatsapp',
                    instanceId,
                    ownerFields,
                    message: {
                        role: 'ai',
                        content: `Template "${template.name}" enviado.`
                    }
                });
                await conversation.save();
                
                lead.status = 'contatado';
                lead.lastContact = new Date();
                await lead.save();

                const components = buildTemplateComponents(template, lead, finalMediaUrl, req.user);
                
                await this._sendMessageHelper(lead, {
                    type: 'template',
                    templateName: template.name,
                    languageCode: template.language,
                    components: components,
                }, instance, req.user.settings);

                successCount++;
            } catch (error) {
                logger.error(`Erro ao iniciar conversa para o lead ${leadId}:`, error);
                errors.push(`Erro para lead ${leadId}: ${error.message}`);
                errorCount++;
            }
        }

        if (successCount > 0) {
            oneSignalService.sendPushNotification(
                userId,
                'Campanha em Lote Iniciada',
                `${successCount} conversas foram iniciadas com sucesso usando o template ${template.name}.`,
                { type: 'campaign', link: '/app/campaigns' }
            );
        }

        res.json({
            success: true,
            message: 'Processamento de múltiplas conversas concluído.',
            successCount,
            errorCount,
            errors
        });
    } catch (error) {
        logger.error('Erro geral ao iniciar múltiplas conversas com template:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  getWhatsAppProvider = async (req, res) => {
        try {
        if (!req.user) {
            return res.status(401).json({ message: 'Usuário não autenticado.' });
        }
        
        const whatsAppProvider = req.user?.settings?.integrations?.whatsappProvider;

        if (!whatsAppProvider) {
            logger.warn(`Provedor de WhatsApp não encontrado para o usuário: ${req.user.id}`);
            return res.status(404).json({ message: 'Configuração do provedor do WhatsApp não encontrada para este usuário.' });
        }

        res.status(200).json({ provider: whatsAppProvider });

        } catch (error) {
        logger.error('Erro ao buscar configuração do provedor de WhatsApp:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
        }
    }
}

module.exports = new WhatsAppAIController();
