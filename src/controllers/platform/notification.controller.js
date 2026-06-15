const { getModel } = require('../../utils/modelProvider');
const Notification = getModel('Notification');
const User = getModel('User'); // Adicionado para salvar o ID do OneSignal
const logger = require('../../utils/logger');
const axios = require('axios');
const socketHub = require('../../utils/socketHub'); // Adicionado para disparar socket manual

class NotificationController {
  getNotifications = async (req, res) => {
    try {
      const { limit = 50, unreadOnly = false } = req.query;
      const query = { user: req.user.id };
      
      if (unreadOnly === 'true') {
        query.isRead = false;
      }
      
      const notifications = await Notification.find(query)
        .sort('-createdAt')
        .limit(parseInt(limit));
        
      res.json({ notifications });
    } catch (error) {
      logger.error('Erro ao buscar notificações:', error);
      res.status(500).json({ message: 'Erro ao buscar notificações' });
    }
  }

  markAsRead = async (req, res) => {
    try {
      const { id } = req.params;
      await Notification.updateOne(
        { _id: id, user: req.user.id },
        { isRead: true }
      );
      res.json({ message: 'Notificação marcada como lida' });
    } catch (error) {
      logger.error('Erro ao marcar notificação como lida:', error);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  markAllAsRead = async (req, res) => {
    try {
      await Notification.updateMany(
        { user: req.user.id, isRead: false },
        { isRead: true }
      );
      res.json({ message: 'Todas as notificações marcadas como lidas' });
    } catch (error) {
      logger.error('Erro ao marcar todas as notificações como lidas:', error);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  // Novo método para deletar todas as notificações do usuário
  deleteAll = async (req, res) => {
    try {
      const result = await Notification.deleteMany({ user: req.user.id });
      res.json({ success: true, message: `${result.deletedCount} notificações excluídas` });
    } catch (error) {
      logger.error('Erro ao excluir todas as notificações:', error);
      res.status(500).json({ message: 'Erro ao excluir notificações' });
    }
  }

  // Novo método para salvar o ID do OneSignal no perfil do usuário
  updateSubscription = async (req, res) => {
    try {
      const { subscriptionId } = req.body;
      if (!subscriptionId) {
        return res.status(400).json({ message: 'subscriptionId é obrigatório' });
      }

      await User.findByIdAndUpdate(req.user.id, {
        oneSignalSubscriptionId: subscriptionId
      });

      logger.info(`[OneSignal] ✅ SubscriptionId sincronizado para o usuário ${req.user.id}: ${subscriptionId}`);
      
      // Dispara o Welcome Push manualmente - DESATIVADO A PEDIDO DO USUARIO
      // this._triggerWelcomePush(subscriptionId);

      res.json({ success: true, message: 'Inscrição atualizada' });
    } catch (error) {
      logger.error('[OneSignal] Erro ao atualizar subscriptionId:', error);
      if (!res.headersSent) res.status(500).json({ message: 'Erro ao salvar inscrição' });
    }
  }

  // Método auxiliar interno
  _triggerWelcomePush = async (subscriptionId) => {
    const appId  = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_API_KEY;

    if (!appId || !apiKey || !subscriptionId) return;

    try {
      await axios.post(
        'https://onesignal.com/api/v1/notifications',
        {
          app_id: appId,
          include_subscription_ids: [subscriptionId],
          headings: { 
            pt: 'QualifAI: Conexão Confirmada',
            en: 'QualifAI: Conexão Confirmada'
          },
          contents: { 
            pt: 'Você está conectado. Receba alertas de leads e campanhas em tempo real.',
            en: 'Você está conectado. Receba alertas de leads e campanhas em tempo real.' 
          },
          url: process.env.FRONTEND_URL || 'https://www.qualifai.tech',
        },
        {
          headers: {
            'Authorization': `Basic ${apiKey}`,
            'Content-Type':  'application/json',
          },
        }
      );
      logger.info(`[OneSignal] Welcome push enviado com sucesso via trigger interno.`);
    } catch (err) {
      logger.error('[OneSignal] Erro no trigger interno de welcome push:', err.message);
    }
  }

  // Novo método para enviar notificação de teste integrada (Socket + OneSignal)
  sendTestNotification = async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);

      const notificationData = {
        user: userId,
        title: 'Teste de Notificação',
        message: 'Suas notificações estão funcionando perfeitamente.',
        type: 'system',
        priority: 'high'
      };

      // 1. Salva no Banco de Dados
      const newNotification = await Notification.create(notificationData);

      // 2. Dispara via Socket.io (Sininho)
      const io = socketHub.getIO();
      if (io) {
        io.to(userId.toString()).emit('notification', { data: newNotification });
        logger.info(`[Notification] Teste enviado via Socket para ${userId}`);
      }

      // 3. Dispara via OneSignal (Push), se configurado
      let pushResult = { status: 'skipped', reason: 'Unknown' };
      
      const appId = process.env.ONESIGNAL_APP_ID;
      const apiKey = process.env.ONESIGNAL_API_KEY;

      if (!user.oneSignalSubscriptionId) {
        pushResult = { status: 'skipped', reason: 'User has no subscriptionId in database' };
        logger.warn(`[OneSignal] ⚠️ Push ignorado para ${userId}: Usuário sem ID no BD.`);
      } else if (!appId || !apiKey) {
        pushResult = { status: 'skipped', reason: 'Credentials missing in .env' };
        logger.warn('[OneSignal] ⚠️ Push ignorado: Credenciais ausentes no .env.');
      } else {
        logger.info(`[OneSignal] 🚀 Tentando enviar push de teste para ID: ${user.oneSignalSubscriptionId}`);
        try {
          const response = await axios.post(
            'https://onesignal.com/api/v1/notifications',
            {
              app_id: appId,
              include_subscription_ids: [user.oneSignalSubscriptionId],
              headings: { 
                pt: 'QualifAI: Notificação de Teste',
                en: 'QualifAI: Notificação de Teste' 
              },
              contents: { 
                pt: 'Tudo pronto. Você receberá alertas aqui mesmo se o navegador estiver fechado.',
                en: 'Tudo pronto. Você receberá alertas aqui mesmo se o navegador estiver fechado.'
              },
              url: process.env.FRONTEND_URL || 'http://localhost:3000',
            },
            {
              headers: {
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json',
              },
            }
          );
          pushResult = { status: 'success', data: response.data };
          logger.info(`[OneSignal] ✅ API OneSignal respondeu sucesso.`);
        } catch (pushError) {
          pushResult = { status: 'error', error: pushError.message };
          logger.error('[OneSignal] ❌ Erro na API do OneSignal.');
        }
      }

      res.json({ 
        success: true, 
        message: 'Teste disparado', 
        socket: !!io, 
        push: pushResult 
      });

    } catch (error) {
      logger.error('Erro no disparo de teste:', error);
      res.status(500).json({ message: 'Erro ao processar teste' });
    }
  }

  sendWelcomePush = async (req, res) => {
    logger.info('[OneSignal] Recebida solicitação de Welcome Push manual.');
    try {
      const { subscriptionId } = req.body;
      if (!subscriptionId) {
        return res.status(400).json({ message: 'subscriptionId é obrigatório.' });
      }

      await this._triggerWelcomePush(subscriptionId);
      res.json({ success: true, message: 'Welcome push enviado' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao enviar notificação.' });
    }
  }
}

module.exports = new NotificationController();
