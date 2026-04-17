
const express = require('express');
const router = express.Router();
const Lead = require('../../models/Lead');
const Conversation = require('../../models/Conversation');
const WhatsAppInstance = require('../../models/WhatsAppInstance');
const User = require('../../models/User'); // Importar User
const aiController = require('../../controllers/ai/ai.controller');
const logger = require('../../utils/logger');
const aiService = require('../../services/aiService');
const whatsappService = require('../../services/whatsappService');

// Webhook para captura de leads de formulários
router.post('/lead-capture', async (req, res) => {
  try {
    const { name, email, phone, company, source = 'form', userId } = req.body;

    const lead = new Lead({
      name,
      email,
      phone,
      company,
      source,
      user: userId
    });

    await lead.save();

    res.json({ success: true, leadId: lead._id });
  } catch (error) {
    logger.error('Erro no webhook de captura:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Webhook para respostas de email
router.post('/email-reply', async (req, res) => {
  try {
    const to = req.body.recipient || req.body.To;
    const from = req.body.sender || req.body.From;
    const body = req.body['body-plain'] || req.body['stripped-text'] || req.body.text;
    const fromName = from.match(/^(.*)<.*>$/)?.[1]?.trim() || from;

    if (!to || !from || !body) {
      logger.warn('Webhook de email recebido com dados incompletos', { body: req.body });
      return res.status(400).json({ message: 'Dados incompletos' });
    }

    const user = await User.findOne({ 'settings.integrations.smtp.auth.user': to });
    if (!user) {
      logger.warn('Usuário não encontrado para o email de destino:', to);
      return res.status(404).json({ message: 'Usuário de destino não encontrado' });
    }

    let lead = await Lead.findOne({ email: from, user: user._id });
    if (!lead) {
      lead = new Lead({
        name: fromName || `Contato ${from}`,
        email: from,
        company: 'Email Reply',
        source: 'email',
        user: user._id,
      });
      await lead.save();
      logger.info('Novo lead criado via resposta de email:', { leadId: lead._id, user: user._id });
    }

    let conversation = await Conversation.findOne({
      lead: lead._id,
      channel: 'email',
      status: 'active'
    });
    if (!conversation) {
      conversation = new Conversation({
        lead: lead._id,
        channel: 'email',
        user: user._id,
        messages: []
      });
      await conversation.save(); // Salva para ter um ID
    }

    const mockReq = {
      body: {
        conversationId: conversation._id.toString(),
        message: body,
        channel: 'email'
      },
      user: user, // Passa o objeto de usuário completo
      app: req.app 
    };
    const mockRes = {
      json: (data) => logger.info('Resposta da IA processada via webhook de email', data),
      status: (statusCode) => ({ json: (errData) => logger.error(`Erro ao processar IA via webhook de email [${statusCode}]`, errData) })
    };

    await aiController.processLeadResponse(mockReq, mockRes);

    res.status(200).json({ success: true, message: 'Email processado' });

  } catch (error) {
    logger.error('Erro no webhook de resposta de email:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});


// Webhook para Evolution API
router.post('/evolution/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const webhookData = req.body;

    logger.info('🔄 Webhook Evolution recebido:', { 
      instanceName, 
      event: webhookData.event,
      timestamp: new Date().toISOString()
    });

    const instance = await WhatsAppInstance.findOne({ instanceName });
    if (!instance) {
      logger.warn('⚠️ Instância não encontrada no banco:', instanceName);
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    await instance.addWebhookEvent(webhookData.event, webhookData).catch(err => logger.error('❌ Erro ao salvar evento webhook:', err.message));

    switch (webhookData.event) {
      case 'messages.upsert':
      case 'MESSAGES_UPSERT':
        await handleNewMessage(instance, webhookData, req.app);
        break;
      case 'connection.update':
      case 'CONNECTION_UPDATE':
        await handleConnectionUpdate(instance, webhookData);
        break;
      case 'qrcode.updated':
      case 'QRCODE_UPDATED':
        await handleQRCodeUpdate(instance, webhookData);
        break;
      default:
        logger.info('ℹ️ Evento não processado:', webhookData.event);
    }

    res.json({ success: true, received: true });
  } catch (error) {
    logger.error('❌ Erro no webhook Evolution:', {
      error: error.message,
      stack: error.stack,
      instanceName: req.params.instanceName
    });
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Webhook para Z-API
router.post('/zapi', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || !req.body.instanceId) {
            console.log('⚠️ Webhook Z-API recebido sem corpo ou instanceId. Ignorando.', { body: req.body });
            return res.sendStatus(200);
        }

        const { instanceId, phone, text, isGroup, ...payload } = req.body;

        console.log('🔄 Webhook Z-API recebido:', { instanceId, type: payload.type || payload.event, phone });
        
        // Ignora eventos que não são mensagens de texto de usuários individuais
        if (isGroup || !phone || !(text?.message || text)) {
          return res.sendStatus(200);
        }
        
        const user = await User.findOne({ 'settings.integrations.zapi.instanceId': instanceId });
        if (!user) {
            console.log(`⚠️ Instância Z-API não encontrada no banco: ${instanceId}`);
            // Retorna 200 para evitar que a Z-API desative o webhook por erros 404.
            return res.status(200).send('Instância não configurada na plataforma.');
        }

        const messageText = text?.message || text;

        const lead = await Lead.findOneAndUpdate(
            { phone: { $regex: phone.replace(/\D/g, ''), $options: 'i' }, user: user._id },
            {
              $setOnInsert: {
                name: payload.senderName || `Contato ${phone}`,
                email: `${phone.replace(/\D/g, '')}@whatsapp.qualifai`,
                phone: phone,
                company: 'Empresa não informada',
                status: 'contacted',
                source: 'whatsapp',
                user: user._id
              },
            },
            { new: true, upsert: true }
        );
        
        if (!lead) {
            console.log(`❌ Não foi possível encontrar ou criar o lead para o número ${phone}`);
            return res.sendStatus(200);
        }

        let conversation = await Conversation.findOne({
            lead: lead._id,
            user: user._id,
            channel: 'whatsapp',
            status: { $ne: 'closed' }
        });

        if (!conversation) {
            conversation = new Conversation({
                lead: lead._id,
                channel: 'whatsapp',
                user: user._id,
                messages: []
            });
            await conversation.save();
        }

        const mockReq = {
            body: { conversationId: conversation._id.toString(), message: messageText, channel: 'whatsapp' },
            user: user,
            app: req.app
        };
        const mockRes = {
            json: (data) => console.log(`[Z-API Webhook] AI response processed for ${conversation._id}`, data),
            status: (statusCode) => ({ json: (errData) => console.log(`[Z-API Webhook] AI processing failed for ${conversation._id} with status ${statusCode}`, errData) })
        };
        
        await aiController.processLeadResponse(mockReq, mockRes);
        console.log('✅ Mensagem processada via Z-API:', { conversationId: conversation._id });
        res.sendStatus(200);

    } catch (error) {
        console.log('❌ Erro no webhook Z-API:', error);
        res.status(200).json({ message: 'Erro interno processado.' });
    }
});


async function handleNewMessage(instance, webhookData, app) {
  if (instance.status !== 'connected') {
    instance.status = 'connected';
    instance.lastConnection = new Date();
    await instance.save();
  }

  const messageData = webhookData.data;
  if (!messageData) return;

  const messages = (messageData.key && messageData.message) ? [messageData] : [];
  if (messages.length === 0) return;

  for (const message of messages) {
    if (message.key?.fromMe) continue;
    
    const phoneNumber = message.key?.remoteJid?.replace('@s.whatsapp.net', '');
    let messageText;

    if (message.message?.conversation) {
      messageText = message.message.conversation;
    } else if (message.message?.extendedTextMessage?.text) {
      messageText = message.message.extendedTextMessage.text;
    } else if (message.message?.audioMessage) {
      try {
        const mediaUrl = await evolutionApiService.getMediaUrl(message.message.audioMessage.mediaKey, instance.apiCredentials.token);
        const audioBuffer = await evolutionApiService.downloadMedia(mediaUrl, instance.apiCredentials.token);
        messageText = await aiService.speechToText(audioBuffer);
        logger.info(`🎤 Áudio transcrito de ${phoneNumber}: "${messageText}"`);
      } catch (audioError) {
        logger.error(`❌ Erro ao processar áudio de ${phoneNumber}:`, audioError);
        continue;
      }
    } else {
        logger.info(`ℹ️ Mensagem de tipo não suportado ignorada de ${phoneNumber}.`);
        continue;
    }

    if (!phoneNumber || !messageText) continue;

    logger.info('📱 Nova mensagem recebida:', { instance: instance.instanceName, phone: phoneNumber, message: messageText });
    await instance.incrementMessageCount('received');
    
    const user = await User.findById(instance.user);
    if (!user) {
        logger.error(`❌ Usuário não encontrado para a instância ${instance.instanceName}`);
        continue;
    }

    const lead = await Lead.findOneAndUpdate(
      { phone: { $regex: phoneNumber, $options: 'i' }, user: instance.user },
      {
        $setOnInsert: {
          name: message.pushName || `Contato ${phoneNumber}`,
          email: this.email || '',
          phone: phoneNumber,
          company: this.company || '',
          source: 'whatsapp',
          user: instance.user
        },
      },
      { new: true, upsert: true }
    );
    if (!lead) {
        logger.error(`❌ Não foi possível encontrar ou criar o lead para ${phoneNumber}`);
        continue;
    }

    let conversation = await Conversation.findOne({
      lead: lead._id,
      user: instance.user,
      channel: 'whatsapp',
      status: { $ne: 'closed' }
    });

    if (!conversation) {
      conversation = new Conversation({
        lead: lead._id,
        channel: 'whatsapp',
        user: instance.user,
        instance: instance._id,
        messages: []
      });
      await conversation.save(); // Salva para ter um ID
    }

    const mockReq = {
      body: {
        conversationId: conversation._id.toString(),
        message: messageText,
        channel: 'whatsapp'
      },
      user: user,
      app: app
    };

    const mockRes = {
      json: (data) => logger.info(`[Evolution Webhook] AI response processed for ${conversation._id}`, data),
      status: (statusCode) => ({ json: (errData) => logger.error(`[Evolution Webhook] AI processing failed for ${conversation._id} with status ${statusCode}`, errData) })
    };

    await aiController.processLeadResponse(mockReq, mockRes);
  }
}

async function handleConnectionUpdate(instance, webhookData) {
  try {
    const connectionState = webhookData.data?.state || webhookData.data?.connection;
    
    if (connectionState) {
      let newStatus = instance.status;
      switch (connectionState) {
        case 'open': newStatus = 'connected'; instance.lastConnection = new Date(); logger.info(`✅ Instância ${instance.instanceName} conectada`); break;
        case 'close': newStatus = 'disconnected'; instance.disconnectedAt = new Date(); logger.info(`❌ Instância ${instance.instanceName} desconectada`); break;
        case 'connecting': newStatus = 'connecting'; logger.info(`🔄 Instância ${instance.instanceName} conectando`); break;
      }
      if (newStatus !== instance.status) {
        instance.status = newStatus;
        await instance.save();
        logger.info(`📊 Status atualizado: ${instance.instanceName} -> ${newStatus}`);
      }
    }
  } catch (error) {
    logger.error('Erro ao processar CONNECTION_UPDATE:', error);
  }
}

async function handleQRCodeUpdate(instance, webhookData) {
  try {
    const qrCodeData = webhookData.qrcode || webhookData.data?.qrcode;
    if (qrCodeData) {
      instance.qrCode = qrCodeData;
      instance.status = 'connecting';
      await instance.save();
      logger.info('✅ QR Code salvo para instância:', { instanceName: instance.instanceName });
    } else {
      logger.warn('⚠️ QR Code não encontrado no webhook data:', { instanceName: instance.instanceName });
    }
  } catch (error) {
    logger.error('❌ Erro ao processar QR Code:', { instanceName: instance.instanceName, error: error.message });
  }
}

module.exports = router;