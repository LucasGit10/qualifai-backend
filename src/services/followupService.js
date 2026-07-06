const { getModel } = require('../utils/modelProvider');
const Conversation = getModel('Conversation');
const User = getModel('User');
const aiController = require('../controllers/ai/ai.controller');
const aiService = require('./aiService');
const logger = require('../utils/logger');
const socketHub = require('../utils/socketHub');
const { hasActiveComplianceDocument } = require('./complianceService');

class FollowupService {
  async checkAndSendFollowups() {
    // logger.info('[DEBUG-SERVICE] Iniciando a função checkAndSendFollowups...');
    try {
      const now = new Date();
      // logger.info(`[DEBUG-SERVICE] Horário atual do servidor para a busca: ${now.toISOString()}`);

      const queryConditions = {
        status: 'active',
        aiEnabled: true,
        'followup.nextAttemptAt': { $lte: now }
      };
      
      // logger.info('[DEBUG-SERVICE] Buscando conversas no banco com as seguintes condições:', queryConditions);
      
      const pendingConversations = await Conversation.find(queryConditions).populate('lead user instance');

      if (pendingConversations.length === 0) {
        // logger.info('[DEBUG-SERVICE] Nenhuma conversa pendente encontrada na busca. Verificação concluída.');
        return;
      }

      // logger.info(`[DEBUG-SERVICE] SUCESSO! ${pendingConversations.length} conversa(s) pendente(s) encontrada(s). Processando agora...`);

      for (const conversation of pendingConversations) {
        // logger.info(`[DEBUG-SERVICE] Processando conversa ID: ${conversation._id}`);
        const { lead, user, instance } = conversation;
        const followupConfig = user?.settings?.aiConfig?.followup;
        const manualMessage = typeof conversation.followup?.message === 'string'
          ? conversation.followup.message.trim()
          : '';
        const isManualFollowup = Boolean(manualMessage);

        if (!lead || !user) {
            // logger.warn(`[DEBUG-SERVICE] Conversa ${conversation._id} ignorada: Lead ou Usuário não encontrado.`);
            continue;
        }

        if (!(await hasActiveComplianceDocument(user))) {
          conversation.followup.nextAttemptAt = null;
          conversation.followup.message = undefined;
          await conversation.save();
          logger.warn('[Followup] Conversa ' + conversation._id + ' bloqueada por ausencia de documento de compliance.');
          continue;
        }

        if (
          isManualFollowup &&
          conversation.followup.cancelIfReplied !== false &&
          conversation.lastInboundMessageAt &&
          conversation.followup.scheduledAt &&
          new Date(conversation.lastInboundMessageAt) > new Date(conversation.followup.scheduledAt)
        ) {
          conversation.followup.nextAttemptAt = null;
          conversation.followup.message = undefined;
          if (lead.nextAction?.status === 'scheduled') {
            lead.nextAction.status = 'cancelled';
            lead.nextAction.cancelledAt = new Date();
            lead.nextFollowUp = undefined;
            await lead.save();
          }
          await conversation.save();
          continue;
        }

        if (!isManualFollowup && (!followupConfig || !followupConfig.enabled)) {
          // logger.warn(`[DEBUG-SERVICE] Conversa ${conversation._id} ignorada: Follow-up desabilitado para o usuário ${user.email}.`);
          conversation.followup.nextAttemptAt = null;
          await conversation.save();
          continue;
        }

        const maxAttempts = isManualFollowup ? 1 : followupConfig.maxAttempts;

        if (conversation.followup.attempts >= maxAttempts) {
          // logger.warn(`[DEBUG-SERVICE] Conversa ${conversation._id} ignorada: Limite de ${followupConfig.maxAttempts} tentativas atingido.`);
          conversation.followup.nextAttemptAt = null;
          await conversation.save();
          continue;
        }

        try {
          const followupMessage = isManualFollowup
            ? manualMessage
            : await aiService.generateFollowupMessage(
                followupConfig.message,
                lead.name
              );
          
          // logger.info(`[DEBUG-SERVICE] TUDO CERTO! Enviando tentativa ${conversation.followup.attempts + 1} para o lead ${lead._id}. Mensagem: "${followupMessage}"`);

          await aiController.sendMessageToChannel(lead, { type: 'text', content: followupMessage }, conversation.channel, user.settings, instance);
          
          conversation.messages.push({
            role: 'ai',
            content: followupMessage,
            channel: conversation.channel
          });

          conversation.followup.attempts += 1;

          // ===== LÓGICA DE REAGENDAMENTO ALTERADA AQUI =====
          const nextAttempt = new Date();
          let followupRescheduled = false;

          if (isManualFollowup) {
            conversation.followup.nextAttemptAt = null;
            conversation.followup.message = undefined;
            conversation.followup.source = 'auto';
            if (lead.nextAction?.status === 'scheduled') {
              lead.nextAction.status = 'sent';
              lead.nextAction.sentAt = new Date();
              lead.nextFollowUp = undefined;
              await lead.save();
            }
          } else if (followupConfig.waitUnit === 'days') {
            nextAttempt.setDate(nextAttempt.getDate() + followupConfig.waitPeriod);
            followupRescheduled = true;
          } else if (followupConfig.waitUnit === 'hours') {
            nextAttempt.setHours(nextAttempt.getHours() + followupConfig.waitPeriod);
            followupRescheduled = true;
          }
          
          // Se a unidade for válida, reagenda. Se não, cancela futuros follow-ups.
          if (!isManualFollowup && followupRescheduled) {
            conversation.followup.nextAttemptAt = nextAttempt;
            // logger.info(`[DEBUG-SERVICE] MENSAGEM ENVIADA para a conversa ${conversation._id}. Próxima tentativa agendada para ${nextAttempt.toISOString()}.`);
          } else if (!isManualFollowup) {
            conversation.followup.nextAttemptAt = null; // Cancela o follow-up
            // logger.warn(`[DEBUG-SERVICE] Unidade de tempo inválida ('${followupConfig.waitUnit}'). Follow-ups para a conversa ${conversation._id} foram encerrados.`);
          }
          // ===============================================

          await conversation.save();
          
          const io = socketHub.getIO();
          if (io) {
            io.to(`user-${user._id.toString()}`).emit('conversation_updated', { conversation });
          }

        } catch (error) {
          // logger.error(`[DEBUG-SERVICE] ERRO FATAL ao processar o ENVIO para a conversa ${conversation._id}:`, error);
          const nextAttempt = new Date();
          nextAttempt.setHours(nextAttempt.getHours() + 1); // Tenta novamente em 1 hora em caso de falha no envio
          conversation.followup.nextAttemptAt = nextAttempt;
          await conversation.save();
        }
      }
    } catch (error) {
      // logger.error('[DEBUG-SERVICE] ERRO GERAL na função checkAndSendFollowups:', error);
    }
  }
}

module.exports = new FollowupService();
