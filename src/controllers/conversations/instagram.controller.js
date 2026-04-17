// ARQUIVO: controllers/instagramController.js

const logger = require('../../utils/logger'); // Certifique-se que o caminho está correto
const instagramService = require('../../services/instagramService');
const User = require('../../models/User');
const INSTAGRAM_VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;

// --- FUNÇÕES DE GERENCIAMENTO DA CONEXÃO ---

async function connectAccountWithSDK(req, res) {
    logger.info('[Instagram SDK] Iniciando conexão de conta.');
    try {
        const { accessToken } = req.body;
        const userId = req.user._id;

        if (!accessToken) {
            return res.status(400).json({ error: 'O accessToken é obrigatório.' });
        }
        
        const connectionDetails = await instagramService.completeOnboardingWithSDK(accessToken, userId);

        res.status(200).json({
            message: 'Conta do Instagram conectada com sucesso!',
            pageName: connectionDetails.pageName,
        });

    } catch (err) {
        logger.error("[Instagram SDK] Erro fatal no fluxo:", { message: err.message });
        res.status(500).json({ error: 'Falha ao conectar a conta do Instagram.', details: err.message });
    }
}

async function getStatus(req, res) {
    try {
        const userId = req.user._id;
        const status = await instagramService.getConnectionStatus(userId);
        res.status(200).json(status);
    } catch (err) {
        logger.error("[Instagram Status] Erro ao buscar status:", { message: err.message });
        res.status(500).json({ error: 'Falha ao buscar status da conexão.' });
    }
}

async function disconnectAccount(req, res) {
    try {
        const userId = req.user._id;
        // Esta linha agora funcionará porque 'User' está definido
        await User.findByIdAndUpdate(userId, {
            $set: {
                'settings.integrations.instagram': { enabled: false, pageId: null, pageName: null, accessToken: null }
            }
        });
        logger.info(`[Instagram] Conta desconectada para o usuário ${userId}`);
        res.status(200).json({ message: 'Conta do Instagram desconectada com sucesso.' });
    } catch (err) {
        logger.error("[Instagram Disconnect] Erro ao desconectar:", { message: err.message });
        res.status(500).json({ error: 'Falha ao desconectar conta.' });
    }
}


// --- FUNÇÕES DE WEBHOOK ---

function verifyWebhook(req, res) {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === INSTAGRAM_VERIFY_TOKEN) {
        logger.info('[Instagram Webhook] Verificado com sucesso!');
        return res.status(200).send(challenge);
    }
    logger.warn('[Instagram Webhook] Falha na verificação.');
    return res.sendStatus(403);
}

function handleWebhookEvent(req, res) {
    try {
        const body = req.body;
        if (body.object !== 'instagram') return res.sendStatus(200);

        body.entry.forEach(entry => {
            if (entry.messaging) {
                const event = entry.messaging[0];
                if (event.message && event.message.text && !event.message.is_echo) {
                    instagramService.processDirectMessage(event);
                }
            }
            if (entry.changes) {
                const change = entry.changes[0];
                if (change.field === 'comments') {
                    instagramService.processPostComment(change.value);
                }
            }
        });
        console.log("Tipo de evento:", entry.changes[0].field);
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        logger.error('[Instagram Webhook] Erro ao processar evento:', error);
        res.sendStatus(500);
    }
}

module.exports = {
    connectAccountWithSDK,
    getStatus,
    disconnectAccount,
    verifyWebhook,
    handleWebhookEvent
};