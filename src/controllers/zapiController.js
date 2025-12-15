const zapiService = require('../services/zapiService');
const User = require('../models/User');
const logger = require('../utils/logger');

class ZapiController {
  async connect(req, res) {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);
      const zapiConfig = user.settings?.integrations?.zapi;

      if (!zapiConfig?.instanceId || !zapiConfig?.token) {
        return res.status(400).json({ message: 'Credenciais da Z-API (Instance ID e Token) não configuradas.' });
      }

      const qrCodeData = await zapiService.getQRCode(zapiConfig.instanceId, zapiConfig.token);
      res.json({ success: true, qrCodeBase64: qrCodeData.value });
    } catch (error) {
      logger.error('Erro ao conectar na Z-API:', error.response?.data || error.message);
      res.status(500).json({ message: error.response?.data?.error || 'Erro ao gerar QR Code.' });
    }
  }

  async disconnect(req, res) {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);
      const zapiConfig = user.settings?.integrations?.zapi;

      if (!zapiConfig?.instanceId || !zapiConfig?.token) {
        return res.status(400).json({ message: 'Credenciais da Z-API não configuradas.' });
      }
      
      await zapiService.logoutInstance(zapiConfig.instanceId, zapiConfig.token);

      logger.info(`Usuário ${userId} desconectou da instância Z-API ${zapiConfig.instanceId}`);

      res.json({ success: true, message: 'Instância desconectada com sucesso.' });
    } catch (error) {
      logger.error('Erro ao desconectar da Z-API:', error.response?.data || error.message);
      res.status(500).json({ message: 'Erro ao desconectar instância.' });
    }
  }

  async getStatus(req, res) {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);
      const zapiConfig = user.settings?.integrations?.zapi;

      if (!zapiConfig?.instanceId || !zapiConfig?.token) {
        return res.status(400).json({ message: 'Credenciais da Z-API não configuradas.' });
      }

      const statusData = await zapiService.getInstanceStatus(zapiConfig.instanceId, zapiConfig.token);
      res.json({ success: true, status: statusData });
    } catch (error) {
      logger.error('Erro ao buscar status da Z-API:', error.response?.data || error.message);
      res.status(500).json({ message: 'Erro ao buscar status.' });
    }
  }

  async sendMessage(req, res) {
    try {
      const { phone, message } = req.body;
      if (!phone || !message) {
        return res.status(400).json({ message: 'Parâmetros "phone" e "message" são obrigatórios.' });
      }
      const userId = req.user.id;
      const user = await User.findById(userId);
      const zapiConfig = user.settings?.integrations?.zapi;
      if (!zapiConfig?.instanceId || !zapiConfig?.token) {
        return res.status(400).json({ message: 'Credenciais da Z-API não configuradas.' });
      }
      const response = await zapiService.sendMessage(zapiConfig.instanceId, zapiConfig.token, phone, message);
      res.json({ success: true, data: response });
    } catch (error) {
      logger.error('Erro ao enviar mensagem via Z-API:', error.response?.data || error.message);
      res.status(500).json({ message: 'Erro ao enviar mensagem.' });
    }
  }
  
}

module.exports = new ZapiController();