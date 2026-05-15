const Conversation = require('../../models/Conversation');
const User = require('../../models/User');
const Lead = require('../../models/Lead');
const aiService = require('../../services/ai/aiChatService');
const whatsappService = require('../../services/whatsapp/whatsappService');
const oneSignalService = require('../../services/notification/oneSignalService');
const logger = require('../../utils/logger');

const isAiUnavailableResult = (result) =>
    result?.aiUnavailable === true || result?.action === 'disable_ai';

const getAiReply = (result) =>
    typeof result === 'string' ? result : result?.reply;

const disableAiWithoutReply = (conversation, channel, errorDetail) => {
    conversation.aiEnabled = false;
    conversation.messages.push({
        role: 'system',
        content: `⚠️ FALHA TÉCNICA NA IA: ${errorDetail || 'Erro interno no processamento'}. A automação foi desativada por segurança.`,
        channel,
    });
};

class AIController {
    async processLeadMessage(req, res) {
        const { conversationId, message, channel } = req.body;
        const userId = req.user.id;

        try {
            const conversation = await Conversation.findOne({ _id: conversationId, user: userId }).populate('lead').populate('instance');

            if (!conversation) {
                return res.status(404).json({ message: 'Conversa não encontrada' });
            }

            const lead = conversation.lead;
            if (!lead) {
                return res.status(404).json({ message: 'Lead não encontrado' });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            
            const instance = channel === 'whatsapp' ? conversation.instance : null;

            // Log da mensagem recebida
            conversation.messages.push({ role: 'lead', content: message, channel });
            conversation.lastMessageAt = new Date();
            conversation.unreadCount = (conversation.unreadCount || 0) + 1;
            await conversation.save();

            // Emitir evento de mensagem recebida
            req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });

            if (!conversation.aiEnabled) {
                return res.json({ success: true, aiEnabled: false, message: 'IA desativada para esta conversa.' });
            }

            const needsHuman = await aiService.detectHumanHandoffRequest(message);

            if (needsHuman && conversation.aiEnabled) {
                logger.info(`[Handoff] Lead ${lead._id} solicitou especialista. Escalando...`);

                conversation.handedOffToHuman = true;
                conversation.handedOffAt = new Date();
                conversation.status = 'escalated';
                conversation.aiEnabled = false;

                let conversationSummary = '';
                try {
                    conversationSummary = await aiService.summarizeConversation(conversation.messages, lead);
                } catch (summaryError) {
                    conversationSummary = 'Não foi possível gerar o resumo automático.';
                }

                conversation.messages.push({
                    role: 'system',
                    content: 'O lead solicitou falar com um especialista. A IA foi desativada.',
                    channel: conversation.channel,
                });

                conversation.messages.push({
                    role: 'system',
                    content: `📋 RESUMO DA CONVERSA PARA O ATENDENTE:\n${conversationSummary}`,
                    channel: conversation.channel,
                });

                const finalAiResponse = "Entendido. Um de nossos especialistas entrará em contato em breve para ajudar.";
                conversation.messages.push({ role: 'ai', content: finalAiResponse, channel });
                
                await conversation.save();
                await this.sendMessageToChannel(lead, { type: 'text', content: finalAiResponse }, channel, user.settings, instance);
                
                req.app.get('io').to(`user-${userId}`).emit('conversation_escalated', { conversation });
                return res.json({ success: true, conversation, aiResponse: finalAiResponse });
            }

            // Gerar resposta da IA
            const aiResult = await aiService.generateResponse(conversation, lead, user);

            if (isAiUnavailableResult(aiResult)) {
                logger.error('[AI Action] Erro crítico na IA:', aiResult.error);
                disableAiWithoutReply(conversation, channel, aiResult.error);
                await conversation.save();
                req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });
                return res.json({ success: true, conversation, aiResponse: null, message: 'IA desativada por erro técnico.' });
            }

            const aiResponse = getAiReply(aiResult);

            // Verificação de solicitação de humano pela própria IA
            if (aiResult.action === 'request_human') {
                conversation.handedOffToHuman = true;
                conversation.status = 'escalated';
                conversation.aiEnabled = false;

                let conversationSummary = '';
                try {
                    conversationSummary = await aiService.summarizeConversation(conversation.messages, lead);
                } catch (e) { conversationSummary = 'Resumo indisponível.'; }

                conversation.messages.push({
                    role: 'system',
                    content: `📋 RESUMO DA CONVERSA:\n${conversationSummary}`,
                    channel: conversation.channel,
                });
            }

            conversation.messages.push({ role: 'ai', content: aiResponse, channel });
            conversation.lastOutboundMessageAt = new Date();
            await conversation.save();

            // Enviar mensagem
            await this.sendMessageToChannel(lead, { type: 'text', content: aiResponse }, channel, user.settings, instance);
            
            req.app.get('io').to(`user-${userId}`).emit('conversation_updated', { conversation });

            return res.json({ success: true, aiResponse });

        } catch (error) {
            logger.error('Erro ao processar mensagem do lead:', error);
            res.status(500).json({ message: 'Erro interno do servidor.' });
        }
    }

    async sendMessageToChannel(lead, messagePayload, channel, userSettings, instance) {
        if (channel === 'whatsapp') {
            await whatsappService.sendMessage(instance, lead.phone, messagePayload.content);
        }
    }
}

module.exports = new AIController();
