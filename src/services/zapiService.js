const axios = require('axios');
const logger = require('../utils/logger');

class ZapiService {
  constructor() {
    this.baseURL = process.env.ZAPI_URL || 'https://api.z-api.io';
  }

  _getApi(instanceId, token) {
    const clientToken = process.env.ZAPI_CLIENT_TOKEN;
    if (!instanceId || !token || !clientToken) {
      throw new Error('Instance ID, Token (usuário) e Client-Token (ambiente) são obrigatórios para a Z-API');
    }
    return axios.create({
      baseURL: `${this.baseURL}/instances/${instanceId}/token/${token}`,
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      timeout: 30000,
    });
  }

  async getQRCode(instanceId, token) {
    const api = this._getApi(instanceId, token);
    const response = await api.get('/qr-code');
    return response.data; // ex: { value: 'qr-code-string-data' }
  } 

  async getInstanceStatus(instanceId, token) {
    const api = this._getApi(instanceId, token);
    const response = await api.get('/status');
    return response.data; // ex: { connected: true, ... }
  }

  async sendMessage(instanceId, token, phone, message) {
    const api = this._getApi(instanceId, token);
    const payload = { phone, message };
    const response = await api.post('/send-text', payload);
    return response.data;
  }
  
  async sendAudioMessage(instanceId, token, phone, audioBuffer) {
    const api = this._getApi(instanceId, token);
    const base64Audio = audioBuffer.toString('base64');
    const payload = {
      phone,
      audio: `data:audio/ogg;base64,${base64Audio}`,
    };
    try {
      const response = await api.post('/send-audio', payload);
      logger.info(`[Z-API] Mensagem de áudio enviada para ${phone}`);
      return response.data;
    } catch (error) {
      logger.error('Erro ao enviar áudio via Z-API:', error.response?.data || error.message);
      throw new Error(`Erro ao enviar áudio via Z-API: ${error.response?.data?.error || error.message}`);
    }
  }

  async logoutInstance(instanceId, token) {
    const api = this._getApi(instanceId, token);
    const response = await api.get('/logout'); // Z-API usa GET para logout
    return response.data;
  }
}

module.exports = new ZapiService();