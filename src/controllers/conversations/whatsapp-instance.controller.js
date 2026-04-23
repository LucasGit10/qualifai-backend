const { getModel } = require('../../utils/modelProvider');
const WhatsAppInstance = getModel('WhatsAppInstance');
const whatsappService = require('../../services/whatsappService');
const Conversation = getModel('Conversation');
const Lead = getModel('Lead');
const aiService = require('../../services/aiService');
const logger = require('../../utils/logger');
const User = getModel('User');
const aiController = require('../ai/ai.controller');
const whatsappAiController = require('./whatsapp-ai.controller');
const MessageTemplate = getModel('MessageTemplate');
const axios = require('axios'); // <-- ADICIONADO PARA FAZER A CHAMADA

async function completeOnboarding(req, res) {
    logger.info('[Onboarding] Iniciando processamento do onboarding do WhatsApp.');
    try {
        const { code, accessToken } = req.body;

        logger.info('[Onboarding] Dados recebidos:', {
            hasCode: !!code,
            hasAccessToken: !!accessToken,
            codeLength: code ? code.length : 0,
            bodyKeys: Object.keys(req.body),
            userId: req.user?._id
        });

        if (!req.user || !req.user._id) {
            logger.error('[Onboarding] Usuário não autenticado ou sem ID.');
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        let connectionDetails;

        if (code) {
            logger.info('[Onboarding] Código de autorização recebido. Trocando por token na Meta.');
            try {
                connectionDetails = await whatsappService.exchangeCodeForTokensAndInfo(code);
                logger.info('[Onboarding] exchangeCodeForTokensAndInfo executado com sucesso.');
            } catch (exchangeError) {
                logger.error('[Onboarding] Erro ao trocar código por token:', {
                    message: exchangeError.message,
                    stack: exchangeError.stack
                });
                throw exchangeError;
            }
        } else if (accessToken) {
            logger.info('[Onboarding] Access token recebido. Obtendo detalhes da conexão diretamente.');
            try {
                connectionDetails = await whatsappService.getConnectionDetailsFromToken(accessToken);
                logger.info('[Onboarding] getConnectionDetailsFromToken executado com sucesso.');
            } catch (tokenError) {
                logger.error('[Onboarding] Erro ao obter detalhes do token:', {
                    message: tokenError.message,
                    stack: tokenError.stack
                });
                throw tokenError;
            }
        } else {
            logger.error('[Onboarding] FALHA: Nem "code" nem "accessToken" foram fornecidos.');
            return res.status(400).json({ error: 'O código de autorização ou o token de acesso é obrigatório.' });
        }

        if (!connectionDetails) {
            logger.error('[Onboarding] connectionDetails está vazio ou undefined após chamada ao service.');
            return res.status(500).json({ error: 'Falha ao obter detalhes da conexão - dados vazios retornados.' });
        }

        const requiredFields = ['phoneNumberId', 'accessToken', 'displayName'];
        const missingFields = requiredFields.filter(field => !connectionDetails[field]);

        if (missingFields.length > 0) {
            logger.error('[Onboarding] Campos obrigatórios ausentes nos detalhes da conexão:', {
                missingFields,
                connectionDetails: Object.keys(connectionDetails)
            });
            return res.status(500).json({
                error: `Dados de conexão incompletos. Campos ausentes: ${missingFields.join(', ')}`
            });
        }

        logger.info('[Onboarding] Detalhes da conexão validados. Salvando no banco de dados.');

        try {
            const instance = await WhatsAppInstance.findOneAndUpdate(
                { phoneNumberId: connectionDetails.phoneNumberId, user: req.user._id },
                {
                    $set: {
                        instanceName: connectionDetails.displayName,
                        phoneNumber: connectionDetails.phoneNumber || '',
                        wabaId: connectionDetails.wabaId || '',
                        status: 'connected',
                        apiCredentials: { token: connectionDetails.accessToken },
                        user: req.user._id,
                        lastConnection: new Date()
                    },
                },
                { new: true, upsert: true, setDefaultsOnInsert: true }
            );

            if (!instance) {
                logger.error('[Onboarding] Falha ao criar/atualizar instância no banco de dados.');
                return res.status(500).json({ error: 'Falha ao salvar instância no banco de dados' });
            }

            logger.info(`[Onboarding] Instância ${instance.instanceName} salva com sucesso para o usuário ${req.user._id}.`);
            res.status(201).json({
                _id: instance._id,
                instanceName: instance.instanceName,
                phoneNumber: instance.phoneNumber,
                phoneNumberId: instance.phoneNumberId,
                wabaId: instance.wabaId,
                status: instance.status,
                createdAt: instance.createdAt,
                updatedAt: instance.updatedAt
            });

        } catch (dbError) {
            logger.error('[Onboarding] Erro ao salvar no banco de dados:', {
                message: dbError.message,
                stack: dbError.stack
            });
            return res.status(500).json({ error: 'Erro interno do banco de dados' });
        }

    } catch (err) {
        logger.error("[Onboarding] ERRO FATAL no fluxo de conexão:", {
            message: err.message,
            stack: err.stack,
            requestBody: req.body,
            userId: req.user?._id
        });

        let errorMessage = 'Falha ao conectar canal do WhatsApp.';
        let statusCode = 500;

        if (err.message.includes('META_APP_ID') || err.message.includes('META_APP_SECRET')) {
            errorMessage = 'Configuração da aplicação Meta incorreta.';
        } else if (err.message.includes('token')) {
            errorMessage = 'Token de acesso inválido ou expirado.';
            statusCode = 401;
        } else if (err.message.includes('code')) {
            errorMessage = 'Código de autorização inválido.';
            statusCode = 400;
        }

        res.status(statusCode).json({
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function createInstance(req, res) {
    logger.info('[CRUD] createInstance: Função iniciada.');
    try {
        const { instanceName, phoneNumber, phoneNumberId, wabaId, apiCredentials } = req.body;
        const userId = req.user._id;

        logger.info('[CRUD] createInstance: Body recebido.', { body: req.body, userId });

        if (!instanceName || !phoneNumber || !phoneNumberId || !wabaId || !apiCredentials || !apiCredentials.token) {
            logger.warn('[CRUD] createInstance: FALHA - Campos obrigatórios ou apiCredentials.token ausentes.');
            return res.status(400).json({ error: 'Todos os campos são obrigatórios, incluindo apiCredentials com um token.' });
        }

        const { token } = apiCredentials;

        logger.info('[CRUD] createInstance: Verificando se a instância já existe.');
        const existing = await WhatsAppInstance.findOne({ instanceName, user: userId });
        if (existing) {
            logger.warn('[CRUD] createInstance: FALHA - Nome da instância duplicado.');
            return res.status(400).json({ error: 'O nome da instância já existe para este usuário.' });
        }

        logger.info('[CRUD] createInstance: Criando novo objeto da instância.');
        const instance = new WhatsAppInstance({
            instanceName,
            phoneNumber,
            phoneNumberId,
            wabaId,
            user: userId,
            status: 'connected',
            apiCredentials: { token }
        });

        logger.info('[CRUD] createInstance: Salvando no banco de dados.');
        await instance.save();

        logger.info('[CRUD] createInstance: Instância salva com sucesso. Enviando resposta 201.');
        res.status(201).json(instance);
    } catch (err) {
        logger.error("[CRUD] Erro ao criar instância:", err);
        res.status(500).json({ error: err.message });
    }
}

async function updateInstanceToken(req, res) {
    try {
        const { instanceId } = req.params;
        const userId = req.user._id;
        const { token: newToken } = req.body;

        if (!newToken) {
            return res.status(400).json({ error: 'O novo token é obrigatório.' });
        }

        const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });

        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada ou não autorizada.' });
        }

        instance.apiCredentials.token = newToken;
        instance.status = 'connected';
        await instance.save();

        res.status(200).json({
            message: 'Token da instância atualizado com sucesso!',
            instanceId: instance._id,
            newStatus: instance.status,
        });

    } catch (err) {
        logger.error('[CRUD] Erro ao atualizar o token da instância:', err);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

async function deleteInstance(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ message: 'O ID da instância é obrigatório.' });
        }
        const deletedInstance = await WhatsAppInstance.findByIdAndDelete(id);
        if (!deletedInstance) {
            return res.status(404).json({ message: 'Instância não encontrada.' });
        }
        res.status(200).json({ message: 'Instância deletada com sucesso.' });
    } catch (err) {
        logger.error("[CRUD] Erro ao deletar instância:", err);
        res.status(500).json({ error: err.message });
    }
}

async function listInstances(req, res) {
    try {
        const userId = req.user._id;
        const instances = await WhatsAppInstance.find({ user: userId });
        res.json(instances);
    } catch (err) {
        logger.error("[CRUD] Erro ao listar instâncias do usuário:", err);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar instâncias.' });
    }
}

async function sendMessage(req, res) {
    // Adicionamos um log no início para capturar os dados da requisição
    logger.info('[sendMessage] Nova requisição para enviar mensagem recebida.');
    logger.info(`[sendMessage] Request Body: ${JSON.stringify(req.body)}`);
    logger.info(`[sendMessage] User ID: ${req.user.id}`);

    try {
        const { conversationId, message, senderRole } = req.body;
        const userId = req.user.id;

        // Log de validação de entrada
        if (!conversationId || !message) {
            logger.warn(`[sendMessage] Validação falhou: conversationId ou message ausente. conversationId: ${conversationId}, message: ${!!message}`);
            return res.status(400).json({ error: 'ID da conversa e mensagem são obrigatórios' });
        }

        logger.info(`[sendMessage] Buscando conversa no DB com ID: ${conversationId} para o usuário: ${userId}`);
        const conversation = await Conversation.findOne({ _id: conversationId, user: userId })
            .populate('instance')
            .populate('lead');

        // Log após a busca no banco de dados
        if (!conversation) {
            logger.warn(`[sendMessage] Conversa com ID ${conversationId} não encontrada para o usuário ${userId}.`);
            return res.status(404).json({ error: 'Conversa não encontrada' });
        }

        logger.info(`[sendMessage] Conversa encontrada. Lead ID: ${conversation.lead?._id}, Instance ID: ${conversation.instance?._id}`);

        // Coleta todos os números únicos do devedor (Array de contatos + telefone principal)
        const phones = new Set();
        if (conversation.lead?.phone) phones.add(conversation.lead.phone);
        
        if (conversation.lead?.contacts && Array.isArray(conversation.lead.contacts)) {
            conversation.lead.contacts.forEach(c => {
                if (c.type === 'phone' && c.value) {
                    phones.add(c.value);
                }
            });
        }

        if (phones.size === 0) {
            logger.warn(`[sendMessage] Lead associado à conversa ${conversationId} não possui números de telefone.`);
            return res.status(400).json({ error: 'O devedor não possui nenhum número de telefone cadastrado.' });
        }

        const instance = conversation.instance;
        if (!instance) {
            throw new Error('Nenhuma instância do WhatsApp (Meta) associada a esta conversa.');
        }

        logger.info(`[sendMessage] Disparando para ${phones.size} número(s): ${Array.from(phones).join(', ')}`);

        // Envia para todos os números
        const results = [];
        for (const num of phones) {
            try {
                const resMeta = await whatsappService.sendTextMessage(instance, num, message);
                results.push({ num, success: true, messageId: resMeta.messages?.[0]?.id });
            } catch (err) {
                logger.error(`[sendMessage] Falha ao enviar para ${num}: ${err.message}`);
                results.push({ num, success: false, error: err.message });
            }
        }

        const successes = results.filter(r => r.success);
        if (successes.length === 0) {
            return res.status(500).json({ 
                error: 'Falha ao enviar mensagem para todos os números cadastrados.',
                details: results
            });
        }

        // Salva uma única mensagem no histórico da conversa para representar o disparo
        logger.info(`[sendMessage] Adicionando mensagem ao histórico da conversa ${conversationId}.`);
        conversation.messages.push({
            role: senderRole || 'humano',
            content: message,
            channel: 'whatsapp',
            timestamp: new Date(),
            metadata: { 
                recipients: Array.from(phones).join(', '),
                results: results
            }
        });
        await conversation.save();

        if (conversation.lead) {
            conversation.lead.lastContact = new Date();
            await conversation.lead.save();
        }

        // Atualiza estatísticas da instância
        await WhatsAppInstance.findByIdAndUpdate(instance._id, { $inc: { 'messagesSent': successes.length } });

        return res.json({ 
            success: true, 
            sentCount: successes.length, 
            totalAttempted: phones.size,
            details: results
        });

    } catch (err) {
        // Log de erro mais detalhado, incluindo o contexto da requisição
        logger.error('Erro em sendMessage:', {
            errorMessage: err.message,
            stack: err.stack,
            conversationId: req.body.conversationId, // Adiciona o ID da conversa ao log de erro
            userId: req.user.id // Adiciona o ID do usuário ao log de erro
        });
        return res.status(500).json({ error: 'Falha ao enviar mensagem', details: err.message });
    }
}

async function listReceivedMessages(req, res) {
    try {
        const { instanceId } = req.params;
        const userId = req.user.id;

        const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
        if (!instance) return res.status(404).json({ error: 'Instance not found' });

        const receivedMessages = instance.webhookEvents.filter(event =>
            event.type === 'message_received' || event.type === 'messages' || event.type === 'message'
        );

        res.json(receivedMessages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function verifyWebhook(req, res) {
    const VERIFY_TOKEN = 'ajndakndkandaanjdknda';
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        logger.info('[Webhook] Webhook verificado com sucesso!');
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
}

function corrigirNumeroBrasil(numero) {
    if (!numero.startsWith('55')) return numero;
    const ddd = numero.slice(2, 4);
    let restante = numero.slice(4);
    if (restante.length === 8) {
        restante = '9' + restante;
        return `55${ddd}${restante}`;
    }
    return numero;
}


async function receiveWebhook(req, res) {
    try {
        logger.info('[WEBHOOK] Nova requisição recebida da Meta.');
        const body = req.body;

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                const changes = entry.changes?.[0];
                if (!changes || changes.field !== 'messages') {
                    continue;
                }

                const value = changes.value;
                const phoneNumberId = value.metadata?.phone_number_id;

                if (!phoneNumberId) {
                    logger.warn('[WEBHOOK] phoneNumberId não encontrado no payload. Pulando.');
                    continue;
                }

                const instance = await WhatsAppInstance.findOne({ phoneNumberId }).populate('user');
                if (!instance || !instance.user) {
                    logger.warn(`[WEBHOOK] Instância ou usuário não encontrado para phoneNumberId: ${phoneNumberId}. Pulando.`);
                    continue;
                }

                if (value.statuses) {
                    for (const statusUpdate of value.statuses) {
                        logger.info(`[WEBHOOK] STATUS UPDATE: Mensagem ${statusUpdate.id} para ${statusUpdate.recipient_id} agora está '${statusUpdate.status}'.`);
                        const lead = await Lead.findOne({ phone: statusUpdate.recipient_id, user: instance.user._id });
                        if (lead) {
                            await Conversation.updateOne(
                                { lead: lead._id, user: instance.user._id, status: { $ne: 'closed' } },
                                {
                                    $push: {
                                        messages: {
                                            role: 'system',
                                            content: `[Status da Mensagem] Status alterado para: ${statusUpdate.status.toUpperCase()}`,
                                            channel: 'whatsapp'
                                        }
                                    }
                                }
                            );
                        }
                    }
                }

                if (value.messages) {
                    for (const msg of value.messages) {
                        const messageId = msg.id;
                        if (!messageId) continue;

                        const from = corrigirNumeroBrasil(msg.from);

                        // Busca o Lead pelo número principal OU por qualquer número no array de contatos
                        let lead = await Lead.findOne({
                            user: instance.user._id,
                            $or: [
                                { phone: from },
                                { "contacts.value": from }
                            ]
                        });

                        // Se não encontrou, cria um novo
                        if (!lead) {
                            lead = new Lead({
                                user: instance.user._id,
                                phone: from,
                                name: value.contacts?.[0]?.profile?.name || from,
                                email: `${from}@whatsapp.qualifai`,
                                company: 'Não Informado',
                                source: 'whatsapp',
                                contacts: [{ type: 'phone', value: from, label: 'WhatsApp' }]
                            });
                        }

                        // Atualiza data do último contato
                        lead.lastContact = new Date();
                        await lead.save();

                        let conversation = await Conversation.findOne({
                            user: instance.user._id,
                            lead: lead._id,
                            channel: 'whatsapp',
                            status: { $ne: 'closed' }
                        }).sort({ updatedAt: -1 });

                        if (!conversation) {
                            logger.info(`[WEBHOOK] Criando nova conversa para o lead ${lead.name} (${lead._id})`);
                            conversation = new Conversation({
                                user: instance.user._id,
                                instance: instance._id,
                                lead: lead._id,
                                channel: 'whatsapp'
                            });
                            await conversation.save();
                        }

                        const alreadyProcessed = await Conversation.findOne({ _id: conversation._id, processedMessageIds: messageId });
                        if (alreadyProcessed) {
                            logger.warn(`[WEBHOOK] Mensagem duplicada ignorada. ID: ${messageId}`);
                            continue;
                        }
                        await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { processedMessageIds: messageId } });

                        let messageText;
                        if (msg.type === 'text') {
                            messageText = msg.text?.body;
                        } else if (msg.type === 'audio' && msg.audio?.id) {
                            try {
                                const mediaUrl = await whatsappService.getMediaUrl(msg.audio.id, instance.apiCredentials.token);
                                const audioBuffer = await whatsappService.downloadMedia(mediaUrl, instance.apiCredentials.token);
                                messageText = await aiService.speechToText(audioBuffer);
                                // Define a URL da API que servirá para o Frontend recuperar o audio
                                const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5000';
                                msg.audio.frontendUrl = `/api/whatsapp-instances/media/${instance._id}/${msg.audio.id}`;
                            } catch (error) {
                                logger.error(`[WEBHOOK] Falha ao processar áudio de ${from}:`, error);
                                continue;
                            }
                        } else {
                            continue;
                        }
                        if (!messageText) continue;

                        const provider = instance.user?.settings?.integrations?.whatsappProvider;

                        const mockReq = {
                            body: {
                                conversationId: conversation._id.toString(),
                                message: messageText,
                                channel: 'whatsapp',
                                audioUrl: msg.audio?.frontendUrl
                            },
                            user: instance.user,
                            app: req.app
                        };
                        const mockRes = { json: () => { }, status: () => ({ json: () => { } }) };

                        try {
                            logger.info(`[WEBHOOK] Roteando mensagem de ${from} para a IA...`);
                            if (provider === 'whatsapp') {
                                await whatsappAiController.processLeadResponse(mockReq, mockRes);
                            } else {
                                await aiController.processLeadResponse(mockReq, mockRes);
                            }
                        } catch (aiError) {
                            logger.error('[WEBHOOK] Falha ao processar com a IA:', aiError);
                        }
                    }
                }
            }
        }

        return res.sendStatus(200);

    } catch (error) {
        logger.error('[WEBHOOK] Erro fatal no webhook da Meta:', { message: error.message, stack: error.stack });
        return res.sendStatus(200);
    }
}

async function registerWabaInfo(req, res) {
    logger.info('[WABA Register PATCH] Recebida nova solicitação para atualizar detalhes da instância.');

    try {
        const { instanceId } = req.params;
        const { wabaId, phoneNumber } = req.body;

        if (!instanceId) {
            logger.warn('[WABA Register PATCH] FALHA: O ID da instância na URL é obrigatório.');
            return res.status(400).json({ error: 'O ID da instância é obrigatório.' });
        }
        if (!wabaId || !phoneNumber) {
            logger.warn('[WABA Register PATCH] FALHA: wabaId e phoneNumber são obrigatórios.');
            return res.status(400).json({ error: 'Os campos wabaId e phoneNumber são obrigatórios.' });
        }

        logger.info(`[WABA Register PATCH] Procurando instância com ID: ${instanceId}`);

        const updatedInstance = await WhatsAppInstance.findOneAndUpdate(
            { _id: instanceId },
            {
                $set: {
                    wabaId: wabaId,
                    phoneNumber: phoneNumber
                }
            },
            { new: true }
        );

        if (!updatedInstance) {
            logger.error(`[WABA Register PATCH] Instância não encontrada para o ID: ${instanceId}`);
            return res.status(404).json({ error: 'Nenhuma instância do WhatsApp encontrada com o ID fornecido.' });
        }

        logger.info(`[WABA Register PATCH] Instância ${updatedInstance.instanceName} atualizada com sucesso.`);

        return res.status(200).json({
            message: 'Detalhes da instância atualizados com sucesso!',
            instance: updatedInstance
        });

    } catch (error) {
        logger.error('[WABA Register PATCH] Erro inesperado ao atualizar detalhes da instância:', {
            message: error.message,
            stack: error.stack
        });
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
}

// ==========================================================
//  ✅ MÉTODO DE DIAGNÓSTICO
// ==========================================================
async function checkMigrationStatus(req, res) {
    logger.info('[MMLite Check] Recebida requisição para checar status de migração.');
    try {
        const { wabaId, adminToken } = req.body;

        if (!wabaId || !adminToken) {
            logger.warn('[MMLite Check] FALHA: wabaId ou adminToken não fornecidos.');
            return res.status(400).json({ error: 'wabaId e adminToken (Token de Usuário do Sistema) são obrigatórios.' });
        }

        // Este é o token de admin que você gera manually (NÃO o token da instância)
        const token = adminToken;
        const url = `https://graph.facebook.com/v19.0/${wabaId}`;

        logger.info(`[MMLite Check] Consultando API da Meta para o WABA ID: ${wabaId}`);

        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                fields: 'mm_lite_onboarding_status'
            }
        });

        logger.info('[MMLite Check] Resposta da Meta recebida:', response.data);

        // Retorna a resposta da Meta (ex: { "mm_lite_onboarding_status": "MIGRATED", "id": "..." })
        res.status(200).json(response.data);

    } catch (error) {
        // ==========================================================
        //  ✅ CORREÇÃO DO LOG APLICADA AQUI
        // ==========================================================
        logger.error('[MMLite Check] ERRO ao checar status:', {
            message: error.message, // Mensagem de erro do Axios (ex: "Request failed...")
            metaError: error.response?.data?.error, // O objeto de erro REAL da Meta
            stack: error.stack
        });

        if (error.response?.data?.error) {
            // Se for um erro da Meta (ex: "Unknown field"), repassa o erro
            return res.status(400).json(error.response.data.error);
        }

        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
}

// ==========================================================
//  ✅ ROTA PARA STREAMING DE MEDIA (Audio)
// ==========================================================
async function getMediaContent(req, res) {
    try {
        const { instanceId, mediaId } = req.params;
        const userId = req.user.id;

        const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada.' });
        }

        const mediaUrl = await whatsappService.getMediaUrl(mediaId, instance.apiCredentials.token);
        const audioBuffer = await whatsappService.downloadMedia(mediaUrl, instance.apiCredentials.token);

        res.set({
            'Content-Type': 'audio/ogg',
            'Content-Disposition': `inline; filename="audio-${mediaId}.ogg"`,
            'Cache-Control': 'public, max-age=31536000'
        });

        return res.send(audioBuffer);

    } catch (error) {
        logger.error('[Media Endpoint] Falha ao recuperar mídia do WhatsApp:', error.message);
        return res.status(500).json({ error: 'Falha ao recuperar a mídia.' });
    }
}

module.exports = {
    completeOnboarding,
    createInstance,
    listInstances,
    sendMessage,
    listReceivedMessages,
    verifyWebhook,
    receiveWebhook,
    updateInstanceToken,
    deleteInstance,
    registerWabaInfo,
    checkMigrationStatus,
    getMediaContent
};