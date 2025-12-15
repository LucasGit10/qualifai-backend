// ARQUIVO: services/instagramService.js

const axios = require('axios');
const User = require('../models/User');
const Lead = require('../models/Lead');
const Conversation = require('../models/Conversation');
const AIService = require('./aiService');
const logger = require('../utils/logger');

const { META_APP_ID, META_APP_SECRET } = process.env;

// --- LÓGICA DE GERENCIAMENTO DA CONTA (ONBOARDING E STATUS) ---

async function completeOnboardingWithSDK(shortLivedToken, userId) {
    logger.info(`[Instagram SDK] 1. Iniciando onboarding para usuário ${userId}`);
    try {
        const { accessToken, pageId, pageName } = await _exchangeShortTokenForLongToken(shortLivedToken);
        logger.info(`[Instagram SDK] 3. Token de longa duração e página obtidos! PageID: ${pageId}, PageName: ${pageName}`);
        
        const user = await User.findById(userId);
        if (!user) throw new Error('Usuário não encontrado.');

        // ATENÇÃO: Em produção, o 'accessToken' DEVE ser criptografado antes de ser salvo.
        user.settings.integrations.instagram = {
            enabled: true,
            pageId,
            pageName,
            accessToken,
        };

        await user.save();
        logger.info(`[Instagram SDK] 4. Conta conectada e salva para o usuário ${userId}`);
        return { pageName };
    } catch (error) {
        logger.error("[Instagram SDK] ERRO CRÍTICO no fluxo de onboarding:", error.message);
        throw error;
    }
}

async function getConnectionStatus(userId) {
    const user = await User.findById(userId).select('settings.integrations.instagram');
    const instagramConfig = user?.settings?.integrations?.instagram;
    
    if (instagramConfig && instagramConfig.enabled) {
        return {
            enabled: true,
            pageId: instagramConfig.pageId,
            pageName: instagramConfig.pageName,
        };
    }
    return { enabled: false };
}

async function disconnectAccount(userId) {
    await User.findByIdAndUpdate(userId, {
        $set: {
            'settings.integrations.instagram': { enabled: false, pageId: null, pageName: null, accessToken: null }
        }
    });
    logger.info(`[Instagram] Conta desconectada para o usuário ${userId}`);
}


// --- LÓGICA DE PROCESSAMENTO DE WEBHOOK (MENSAGENS E COMENTÁRIOS) ---

async function processDirectMessage(webhookEvent) {
    const senderId = webhookEvent.sender.id;
    const recipientId = webhookEvent.recipient.id; // pageId
    const messageText = webhookEvent.message.text;

    try {
        const user = await _findUserByPageId(recipientId);
        if (!user) return;

        const lead = await _findOrCreateLead(senderId, user);
        
        let conversation = await Conversation.findOne({ lead: lead._id, channel: 'whatsapp', status: 'active' });
        if (!conversation) {
            conversation = new Conversation({ user: user._id, lead: lead._id, channel: 'whatsapp' });
        }

        conversation.messages.push({ role: 'lead', content: messageText, channel: 'whatsapp', timestamp: new Date(webhookEvent.timestamp) });

        const aiResponse = await AIService.generateResponse(conversation, lead, user.settings);
        if (!aiResponse || !aiResponse.reply) throw new Error('Resposta inválida da AIService.');
        
        conversation.messages.push({ role: 'ai', content: aiResponse.reply, channel: 'whatsapp' });
        await conversation.save();

        const userAccessToken = user.settings.integrations.instagram.accessToken;
        await _sendInstagramReply(senderId, aiResponse.reply, userAccessToken);

    } catch (error) {
        logger.error('[Instagram Service] Erro ao processar DM:', error);
    }
}

async function processPostComment(commentData) {
    const pageId = commentData.media.owner.id;
    if (commentData.from.id === pageId || commentData.parent_id) return;

    const senderId = commentData.from.id;

    try {
        const user = await _findUserByPageId(pageId);
        if (!user) return;
        
        const lead = await _findOrCreateLead(senderId, user, commentData.from.username);
        
        const initialMessage = `Olá ${lead.name}! Vi seu comentário em nosso post. Vim te chamar no privado para te dar mais atenção. 😊`;
        const userAccessToken = user.settings.integrations.instagram.accessToken;
        await _sendInstagramReply(senderId, initialMessage, userAccessToken);

        const conversation = new Conversation({
            user: user._id,
            lead: lead._id,
            channel: 'instagram', // Idealmente, adicione 'instagram' ao seu enum de canais
            messages: [{ role: 'ai', content: initialMessage, channel: 'whatsapp' }]
        });
        await conversation.save();
        logger.info(`[Instagram] Conversa iniciada com ${lead.name} em resposta a um comentário.`);

    } catch (error) {
        logger.error('[Instagram Service] Erro ao processar comentário:', error);
    }
}

// --- FUNÇÕES AUXILIARES PRIVADAS ---

async function _exchangeShortTokenForLongToken(shortLivedToken) {
    logger.info('[Instagram SDK] 2. Trocando token de curta duração por um de longa duração...');

    if (!META_APP_ID || !META_APP_SECRET) {
        throw new Error('ERRO FATAL DE CONFIGURAÇÃO: As variáveis de ambiente META_APP_ID e/ou META_APP_SECRET não estão definidas no backend.');
    }

    try {
        const longTokenRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
            params: { grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: shortLivedToken }
        });

        const accessToken = longTokenRes.data.access_token;
        if (!accessToken) throw new Error('A API da Meta não retornou um token de longa duração.');
        logger.info('[Instagram SDK] 2a. Token de longa duração obtido com sucesso.');

        const pagesRes = await axios.get(`https://graph.facebook.com/me/accounts?fields=id,name,instagram_business_account&access_token=${accessToken}`);
        
        if (!pagesRes.data || !pagesRes.data.data) throw new Error('A API da Meta retornou uma resposta inesperada ao buscar as páginas.');
        logger.info(`[Instagram SDK] 2b. Encontradas ${pagesRes.data.data.length} páginas para o usuário.`);

        const pageWithInstagram = pagesRes.data.data.find(p => p.instagram_business_account);
        if (!pageWithInstagram) throw new Error('Nenhuma página com uma conta do Instagram Business conectada foi encontrada. Verifique se a conta do Instagram é do tipo "Profissional" e se está vinculada corretamente à Página do Facebook.');

        return { accessToken, pageId: pageWithInstagram.id, pageName: pageWithInstagram.name };

    } catch (error) {
        logger.error("[Instagram SDK] Falha na comunicação com a API da Meta. Resposta do erro:", error.response?.data || error.message);
        throw new Error("Falha ao validar credenciais com a Meta. Verifique o App ID, App Secret e as permissões do usuário.");
    }
}

async function _findUserByPageId(pageId) {
    const user = await User.findOne({ 'settings.integrations.instagram.pageId': pageId });
    if (!user) logger.warn(`[Instagram] Nenhum usuário encontrado para a pageId ${pageId}.`);
    return user;
}

async function _findOrCreateLead(instagramId, user, leadName = 'Lead do Instagram') {
    const leadIdentifier = `${instagramId}@instagram.qualifai`;
    return Lead.findOneAndUpdate(
        { email: leadIdentifier, user: user._id },
        { $setOnInsert: { name: leadName, email: leadIdentifier, phone: instagramId, company: 'Não informado', source: 'whatsapp', user: user._id, status: 'novo' } },
        { upsert: true, new: true }
    );
}

async function _sendInstagramReply(recipientId, text, userAccessToken) {
    if (!userAccessToken) {
        logger.error(`[Instagram] Tentativa de enviar resposta para ${recipientId} sem um accessToken.`);
        return;
    }
    logger.info(`[Instagram] Enviando DM para ${recipientId}: "${text.substring(0, 50)}..."`);
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${userAccessToken}`,
            { recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" }
        );
    } catch (error) {
        logger.error('Falha ao enviar DM para Instagram:', error.response?.data || error.message);
    }
}

module.exports = {
    completeOnboardingWithSDK,
    getConnectionStatus,
    disconnectAccount,
    processDirectMessage,
    processPostComment,
};