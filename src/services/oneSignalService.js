const axios = require('axios');
const logger = require('../utils/logger');
const { getModel } = require('../utils/modelProvider');

class OneSignalService {
  constructor() {
    this.appId = process.env.ONESIGNAL_APP_ID;
    this.apiKey = process.env.ONESIGNAL_API_KEY;
    this.apiUrl = 'https://onesignal.com/api/v1/notifications';
  }

  isConfigured() {
    return this.appId && this.apiKey;
  }

  /**
   * Dispara uma push notification usando a API REST do OneSignal.
   * @param {Array<string>|string} userIds Array de user IDs externos ou um único ID para direcionar a push. Se nulo/vazio, envia para Active Users (ou All).
   * @param {string} title Título da notificação.
   * @param {string} content Mensagem.
   * @param {Object} data Dados adicionais/metadata opcional.
   */
  async sendPushNotification(externalUserIds, title, content, data = {}) {
    if (!this.isConfigured()) {
      logger.warn('[OneSignal] Ignorando push notification: ONESIGNAL_APP_ID ou ONESIGNAL_API_KEY não configurados.');
      return;
    }

    try {
      const payload = {
        app_id: this.appId,
        headings: { en: title, pt: title },
        contents: { en: content, pt: content },
        data: data
      };

      // Se passou userIds específicos do sistema, enviar apenas para eles (Target by external_id).
      if (externalUserIds && (Array.isArray(externalUserIds) ? externalUserIds.length > 0 : externalUserIds !== '')) {
        const ids = Array.isArray(externalUserIds) ? externalUserIds : [externalUserIds];
        payload.include_external_user_ids = ids.map(id => id.toString());
      } else {
        // Se não informar um external user id específico, manda pra base inscrita do App
        payload.included_segments = ['Subscribed Users'];
      }

      await axios.post(this.apiUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${this.apiKey}`
        }
      });

      // --- PERSISTÊNCIA NO BANCO DE DADOS (NOVO) ---
      try {
        const Notification = getModel('Notification');
        // Salvamos no banco para o(s) usuário(s) específicos. 
        // Se externalUserIds for 'all' ou vazio (o que é raro nos nossos triggers), não salvaríamos aqui ou mapearíamos.
        if (externalUserIds) {
          const ids = Array.isArray(externalUserIds) ? externalUserIds : [externalUserIds];
          const notificationDocs = ids.map(userId => ({
            user: userId,
            title: title,
            message: content,
            type: data?.type || 'system',
            priority: data?.priority || 'medium',
            link: data?.link || '',
            metadata: data
          }));
          await Notification.insertMany(notificationDocs);
          logger.info(`[Notification DB] ${notificationDocs.length} notificações salvas no banco.`);
        }
      } catch (dbError) {
        logger.error('[Notification DB] Falha ao salvar no banco:', dbError.message);
      }

      logger.info(`[OneSignal] Push notificação enviada com sucesso: "${title}"`);
    } catch (error) {
      logger.error('[OneSignal] Erro ao enviar push notification:', error.response?.data || error.message);
    }
  }
}

module.exports = new OneSignalService();
