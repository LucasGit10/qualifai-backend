const { getModel } = require('../../utils/modelProvider');
const Lead = getModel('Lead');
const Conversation = getModel('Conversation');
const User = getModel('User');
const WhatsAppInstance = getModel('WhatsAppInstance');
const MessageTemplate = getModel('MessageTemplate');
const aiService = require('../../services/aiService');
const whatsappService = require('../../services/whatsappService');
const oneSignalService = require('../../services/oneSignalService');
const logger = require('../../utils/logger');

const isAiUnavailableResult = (result) =>
  result?.aiUnavailable === true || result?.action === 'disable_ai';

const disableAiWithoutReply = (conversation, channel) => {
  conversation.aiEnabled = false;
  conversation.messages.push({
    role: 'system',
    content: 'IA desativada automaticamente por indisponibilidade ao processar a mensagem.',
    channel,
  });
};

// buildTemplateComponents (Mantido 100% - Sem alterações)
const buildTemplateComponents = (template, lead, mediaUrl = null) => {
  const components = [];

  template.components.forEach(component => {
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
            value = lead.company || 'sua empresa';
          } else {
            value = `Dado_${varNum}`;
          }
          parameters.push({ type: 'text', text: value });
        });
      }
    }

    if (parameters.length > 0) {
      // Verifica se já existe um HEADER de mídia adicionado para anexar parâmetros extras se necessário
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

  // startConversationWithTemplate (Mantido 100% - Sem alterações)
  startConversationWithTemplate = async (req, res) => {
    try {
      const { leadId, instanceId, templateId, mediaUrl, imageUrl } = req.body;
      const userId = req.user.id;
      
      let finalMediaUrl = mediaUrl || imageUrl; // Suporta ambos os nomes de campo

      if (!leadId || !instanceId || !templateId) {
        return res.status(400).json({ message: 'leadId, instanceId e templateId são obrigatórios.' });
      }

      const lead = await Lead.findOne({ _id: leadId, user: userId });
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado.' });
      
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId, status: 'connected' });
      if (!instance) return res.status(404).json({ message: 'Instância não encontrada ou desconectada.' });

      const template = await MessageTemplate.findOne({ _id: templateId, user: userId, status: 'approved' });
      if (!template) return res.status(404).json({ message: 'Template não encontrado ou não aprovado.' });

      if (!finalMediaUrl) finalMediaUrl = template.sampleMediaUrl;
      const components = buildTemplateComponents(template, lead, finalMediaUrl);

      const conversation = new Conversation({
        lead: leadId,
        channel: 'whatsapp',
        user: userId,
        instance: instanceId,
        messages: [{
          role: 'ai',
          content: `Conversa iniciada com o template: ${template.name}`,
          channel: 'whatsapp',
        }]
        // O conversationState default 'DISCOVERY' será pego do Schema
      });
      await conversation.save();

      lead.status = 'contatado';
      lead.lastContact = new Date();
      await lead.save();

      await this._sendMessageHelper(lead, {
        type: 'template',
        templateName: template.name,
        languageCode: template.language,
        components: components,
      }, instance, req.user.settings);

      req.app.get('io').to(`user-${userId}`).emit('new_conversation', { conversation, lead });
      
      // Disparo de notificação OneSignal
      oneSignalService.sendPushNotification(
        userId,
        'Conversa Iniciada',
        `A conversa com ${lead.name || 'o cliente'} foi iniciada pelo template automático.`,
        { type: 'whatsapp', link: `/app/conversations-whats?id=${conversation._id}` }
      );

      res.status(200).json({ success: true, message: 'Conversa iniciada com sucesso via template.', conversation });
    } catch (error) {
      logger.error('Erro ao iniciar conversa com template:', error);
      res.status(500).json({ message: 'Erro interno do servidor', details: error.message });
    }
  }

  // ==========================================================
  // --- processLeadResponse (CORRIGIDO PARA FASE 3) ---
  // ==========================================================
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
        let aiResult = null; // Armazena a resposta completa do aiService

        // ================== CORREÇÃO DO BUG (FASE 3) ==================
        // A checagem mudou de `conversation.schedulingAttempt?.status === 'proposed'`
        // para `conversation.conversationState === 'SCHEDULING'`.
        //
        // ETAPA 1: O lead está respondendo a uma proposta de agendamento?
        // (Verificamos se a IA está no estado de agendamento)
        if (conversation.conversationState === 'SCHEDULING') {
            const schedulingResult = await aiService.parseLeadSchedulingResponse(conversation, message);
            
            if (schedulingResult.status === 'CONFIRMED' && schedulingResult.dateTime) {
                // SUCESSO: O lead confirmou um horário
                logger.info(`[Scheduling] Lead ${lead._id} confirmou horário: ${schedulingResult.dateTime}`);
                const meetingTime = new Date(schedulingResult.dateTime);
                const { googleMeetLink } = await aiService.createMeetingInCRMs(user, lead, meetingTime);
                
                conversation.schedulingAttempt.status = 'confirmed'; // (Mantido para UI/compatibilidade)
                conversation.status = 'closed';
                conversation.endedAt = new Date();
                conversation.conversationState = 'CONVERTED'; // NOVO ESTADO DE FIM
                
                const formattedDate = meetingTime.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
                let meetLinkMessage = googleMeetLink ? ` O link para nossa conversa é: ${googleMeetLink}` : '';
                aiResponse = `Excelente! Reunião agendada para ${formattedDate}.${meetLinkMessage} Algo mais em que posso ajudar?`;
                
                lead.status = 'qualificado'; // Status final
                conversationEnded = true; // --- GATILHO DE ESCRITA (SUCESSO) ---

            } else {
                // NEGOCIAÇÃO: O lead rejeitou ou pediu outro horário (ex: "não posso", "outro dia?").
                // Deixamos a IA (Fase 3) decidir a próxima ação.
                logger.info(`[Scheduling] Lead ${lead._id} respondeu no estado SCHEDULING, mas não confirmou. Deixando a IA decidir.`);
                aiResult = await aiService.generateResponse(conversation, lead, user);
            }
        }
        // ================== FIM DA CORREÇÃO ==================
        
        
        // ETAPA 2: Se nenhuma ação de agendamento foi tomada, gera a resposta padrão
        if (!aiResult && !aiResponse) { // Só chama a IA se ela já não foi chamada
            // Passa o 'user' completo
            aiResult = await aiService.generateResponse(conversation, lead, user);
        }
        
        // ETAPA 3: Processa o resultado do aiService (se ele foi chamado)
        if (aiResult) {
            if (isAiUnavailableResult(aiResult)) {
                logger.warn('[AI Action] IA indisponivel. Desativando conversa sem enviar resposta ao lead.', {
                    conversationId: conversation._id,
                    leadId: lead._id,
                    action: aiResult.action,
                    error: aiResult.error,
                });
                disableAiWithoutReply(conversation, channel);
                await conversation.save();
                req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });
                return res.json({ success: true, conversation, aiResponse: null, message: 'IA desativada automaticamente.' });
            }

            aiResponse = aiResult.reply;

            // --- ATUALIZAÇÃO DA FASE 3 ---
            // A IA agora nos diz o novo estado do lead e da conversa
            if (aiResult.leadStatus) {
                lead.status = aiResult.leadStatus;
            }
            if (aiResult.conversationState) {
                conversation.conversationState = aiResult.conversationState;
            }
            // -----------------------------

            // A IA detectou que o lead quer um humano?
            if (aiResult.escalate === true) {
                logger.info(`[Handoff] Lead ${lead._id} solicitou especialista no WhatsApp. Escalando...`);
                conversation.handedOffToHuman = true;
                conversation.handedOffAt = new Date();
                conversation.status = 'escalated';
                conversation.aiEnabled = false;
                // conversation.conversationState = 'ESCALATED' // (Já foi definido pelo aiService)
                conversation.messages.push({
                    role: 'system',
                    content: 'O lead solicitou falar com um especialista. A IA foi desativada.',
                    channel: channel,
                });
                conversationEnded = true; // --- GATILHO DE ESCRITA (ESCALAÇÃO) ---

                // Disparo de notificação OneSignal para o atendente
                oneSignalService.sendPushNotification(
                  userId,
                  'Assistência Humana Solicitada',
                  `O lead ${lead.name || lead.phone} solicitou falar com um humano.`,
                  { type: 'whatsapp', link: `/app/conversations-whats?id=${conversation._id}` }
                );
            }
            
            // A IA decidiu encerrar a conversa (sem agendar e sem escalar)?
            else if (aiResult.endCall === true) {
                logger.info(`[AI Action] IA encerrou a conversa com lead ${lead._id}. Status: ${aiResult.leadStatus}`);
                conversation.status = 'closed';
                conversation.endedAt = new Date();
                // O conversationState (ex: 'DISMISSED') já foi definido pela IA
                conversationEnded = true; // --- GATILHO DE ESCRITA (DISPENSA) ---
            }
        }

        // ETAPA 4: Salvar e Enviar a resposta final
        
        // Salva a resposta da IA (se ela foi definida)
        if (aiResponse) {
            conversation.messages.push({ role: 'ai', content: aiResponse, channel });
            conversation.sentCount = (conversation.sentCount || 0) + 1;
            conversation.lastMessageAt = new Date();
            conversation.lastOutboundMessageAt = new Date();
        }
        
        // Salva todas as atualizações (status, state, messages)
        await lead.save();
        await conversation.save();
        
        // Dispara a análise se a conversa terminou
        if (conversationEnded) {
            logger.info(`[Auto-Treinamento] Conversa ${conversation._id} (WhatsApp) marcada para análise.`);
            // Dispara em background (sem await) para não atrasar a resposta
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
        
        // Envia a mensagem (se houver uma)
        if (aiResponse && !conversation.handedOffToHuman) { // Só envia se a IA ainda estiver ativa
            const messagePayload = { type: 'text', content: aiResponse };
            if (user.settings?.aiConfig?.enableVoiceInteraction) {
                messagePayload.type = 'audio';
                messagePayload.buffer = await aiService.textToSpeech(aiResponse, user.settings.aiConfig.voiceModel);
            }
            // Passa user.settings para o helper
            await this._sendMessageHelper(lead, messagePayload, instance, user.settings);
        
        } else if (aiResponse && conversation.handedOffToHuman) {
            // Envia a última mensagem de handoff ("Estou transferindo...")
             await this._sendMessageHelper(lead, { type: 'text', content: aiResponse }, instance, user.settings);
        }
        
        // Emite a atualização para a UI
        if (conversation.handedOffToHuman) {
            req.app.get('io').to(`user-${userId}`).emit('conversation_escalated', { conversation });
        } else {
            req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });
        }
        
        res.json({ success: true, conversation, aiResponse });
    } catch (error) {
        logger.error('Erro ao processar resposta do lead (WhatsApp):', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
  // ==========================================================
  // --- FIM DA FUNÇÃO AJUSTADA ---
  // ==========================================================

  // startMultipleConversationsWithTemplate (Mantido 100% - Sem alterações)
  startMultipleConversationsWithTemplate = async (req, res) => {
    try {
        const { leadIds, instanceId, templateId } = req.body;
        const userId = req.user.id;

        if (!Array.isArray(leadIds) || !instanceId || !templateId) {
            return res.status(400).json({ message: 'leadIds (array), instanceId e templateId são obrigatórios.' });
        }

        const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId, status: 'connected' });
        if (!instance) return res.status(404).json({ message: 'Instância não encontrada ou desconectada.' });

        const template = await MessageTemplate.findOne({ _id: templateId, user: userId, status: 'approved' });
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
                
                const conversation = new Conversation({
                    lead: leadId,
                    channel: 'whatsapp',
                    user: userId,
                    instance: instanceId,
                    messages: [{
                        role: 'ai',
                        content: `Conversa iniciada com o template: ${template.name}`,
                        channel: 'whatsapp',
                    }]
                });
                await conversation.save();
                
                lead.status = 'contatado';
                lead.lastContact = new Date();
                await lead.save();

                const components = buildTemplateComponents(template, lead);
                
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

        // Notificação de lote
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

  // getWhatsAppProvider (Mantido 100% - Sem alterações)
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
