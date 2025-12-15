const axios = require('axios');
const logger = require('../utils/logger');
const { log } = require('winston');
const FormData = require('form-data');

class EvolutionApiService {
  constructor() {
    this.baseURL = process.env.EVOLUTION_API_URL; //|| 'http://localhost:8080';
    this.apiKey = process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';
    this.webhookUrl = process.env.WEBHOOK_BASE_URL;
    
    this.api = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.apiKey
      },
      timeout: 30000
    });
  }

  // Criar instância do WhatsApp
  async createInstance(instanceName, phoneNumber) {
    try {
      const formattedNumber = phoneNumber.replace(/\D/g, '');
      
      const instanceData = {
      instanceName: instanceName,
        token: this.generateToken(),
        qrcode: true,
        number: formattedNumber,
        integration: 'WHATSAPP-BAILEYS',
        reject_call: false,
        msg_call: 'Mensagens de áudio não são aceitas',
        groups_ignore: true,
        always_online: false,
        read_messages: false,
        read_status: false,
        webhook: `${this.webhookUrl}/api/webhooks/evolution/${instanceName}`,
        webhookByEvents: false,
        webhookBase64: true
    };

      console.log('Criando instância Evolution API:', instanceName, formattedNumber);
      
      logger.info('Criando instância Evolution API:', { instanceName, number: formattedNumber });
      
      const response = await this.api.post('/instance/create', instanceData);
      
      logger.info('Instância criada com sucesso:', response.data);
      
      try {
        //await this.setWebhook(instanceName);
        logger.info('Webhook configurado com sucesso');
      } catch (webhookError) {
        logger.warn('Erro ao configurar webhook (continuando):', webhookError.message);
      }
      
      return response.data;
    } catch (error) {
      logger.error('Erro ao criar instância Evolution API:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw new Error(`Erro ao criar instância: ${error.response?.data?.message || error.message}`);
    }
  }

  async setWebhook(instanceName) {
    try {
      const webhookData = {
        enabled: true,
        url: `${this.webhookUrl}/api/webhooks/evolution/${instanceName}`,
        webhookByEvents: false,
        webhookBase64: true,
        events: [
          'APPLICATION_STARTUP',
          'QRCODE_UPDATED', 
          'CONNECTION_UPDATE',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE'
        ]
      };

      logger.info('Configurando webhook:', webhookData);
      
      const response = await this.api.post(`/webhook/set/${instanceName}`, webhookData);
      return response.data;
    } catch (error) {
      logger.error('Erro ao configurar webhook:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw new Error(`Erro ao configurar webhook: ${error.message}`);
    }
  }

  // Conectar instância
  async connectInstance(instanceName) {
    try {
      const response = await this.api.get(`/instance/connect/${instanceName}`);
      return response.data;
    } catch (error) {
      logger.error('Erro ao conectar instância:', error);
      throw new Error(`Erro ao conectar instância: ${error.response?.data?.message || error.message}`);
    }
  }

  // Obter QR Code (corrigido)
  async getQRCode(instanceName) {
    try {
      // Primeiro, verificar se a instância existe
      const instances = await this.listInstances();
      const instanceExists = instances.find(inst => inst.instanceName === instanceName);
      
      if (!instanceExists) {
        throw new Error('Instância não encontrada na Evolution API');
      }

      // Tentar diferentes endpoints possíveis para QR Code
      let response;
      const possibleEndpoints = [
        `/instance/qrcode/${instanceName}`,
        `/instance/${instanceName}/qrcode`,
        `/qrcode/${instanceName}`,
        `/instance/connect/${instanceName}` // Às vezes o QR vem no connect
      ];

      for (const endpoint of possibleEndpoints) {
        try {
          logger.info(`Tentando obter QR Code via: ${endpoint}`);
          response = await this.api.get(endpoint);
          
          // Verificar se a resposta contém QR Code
          if (response.data && (response.data.qrcode || response.data.base64 || response.data.qr)) {
            logger.info('QR Code obtido com sucesso via:', endpoint);
            return {
              qrcode: response.data.qrcode || response.data.qr,
              base64: response.data.base64 || response.data.qrcode || response.data.qr
            };
          }
        } catch (endpointError) {
          logger.warn(`Endpoint ${endpoint} falhou:`, endpointError.response?.status);
          continue;
        }
      }

      // Se chegou aqui, nenhum endpoint funcionou
      throw new Error('QR Code não disponível. A instância pode já estar conectada ou em erro.');
      
    } catch (error) {
      logger.error('Erro ao obter QR Code:', error);
      throw new Error(`Erro ao obter QR Code: ${error.message}`);
    }
  }

  // Obter status da instância (melhorado)
  async getInstanceStatus(instanceName) {
    try {
      const possibleEndpoints = [
        `/instance/connectionState/${instanceName}`,
        `/instance/${instanceName}/connectionState`,
        `/instance/status/${instanceName}`,
        `/instance/${instanceName}/status`
      ];

      for (const endpoint of possibleEndpoints) {
        try {
          logger.info(`Tentando obter status via: ${endpoint}`);
          const response = await this.api.get(endpoint);
          
          if (response.data) {
            logger.info('Status obtido com sucesso via:', endpoint);
            return response.data;
          }
        } catch (endpointError) {
          logger.warn(`Endpoint ${endpoint} falhou:`, endpointError.response?.status);
          continue;
        }
      }

      throw new Error('Não foi possível obter o status da instância');
    } catch (error) {
      logger.error('Erro ao obter status da instância:', error);
      throw new Error(`Erro ao obter status: ${error.message}`);
    }
  }

  // Enviar mensagem
  async sendMessage(instanceName, phone, message) {
    try {
      const formattedPhone = phone.replace(/\D/g, '');
      
      const messageData = {
        number: formattedPhone,
        textMessage: {
          text: message
        }
      };

      const response = await this.api.post(`/message/sendText/${instanceName}`, messageData);
      return response.data;
    } catch (error) {
      logger.error('Erro ao enviar mensagem:', error);
      throw new Error(`Erro ao enviar mensagem: ${error.message}`);
    }
  }

  async sendAudioMessage(instanceName, phone, audioBuffer) {
    try {
        const formattedPhone = phone.replace(/\D/g, '');
        const formData = new FormData();
        
        formData.append('number', formattedPhone);
        
        // O nome do campo para o áudio é 'mediaMessage' e precisa de um nome de arquivo
        formData.append('mediaMessage', audioBuffer, {
            filename: 'audio.ogg',
            contentType: 'audio/ogg',
        });
        
        // As opções são enviadas como uma string JSON no campo 'options'
        formData.append('options', JSON.stringify({
            type: 'audio',
            ptt: true, // Enviar como mensagem de voz (áudio gravado)
        }));

        const response = await this.api.post(`/message/sendMedia/${instanceName}`, formData, {
            headers: {
                ...formData.getHeaders(),
                'apikey': this.apiKey // Garante que a apikey esteja no header
            },
        });
        return response.data;
    } catch (error) {
        const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`Erro ao enviar mensagem de áudio via Evolution API para ${instanceName}: ${errorDetails}`);
        throw new Error(`Erro ao enviar mensagem de áudio: ${error.message}`);
    }
  }

  // Deletar instância
  async deleteInstance(instanceName) {
    try {
      const response = await this.api.delete(`/instance/delete/${instanceName}`, {
      data: { forceDelete }
    });
    logger.info('Instância deletada via Evolution API:', {
      instance: instanceName,
      forceDelete
    });
      return response.data;
    } catch (error) {
      logger.error('Erro ao deletar instância:', error);
      throw new Error(`Erro ao deletar instância: ${error.message}`);
    }
  }
async fetchQRCode(instanceName) {
  try {
    // Tentar diferentes endpoints que podem retornar QR Code
    let response;
    
    try {
      // Primeiro tentar o endpoint de connect que geralmente retorna QR Code
      response = await this.api.get(`/instance/connect/${instanceName}`);
      
      if (response.data.qrcode) {
        logger.info('QR Code obtido via /connect:', {
          instance: instanceName,
          hasQRCode: true
        });
        return { qrcode: response.data.qrcode, ...response.data };
      }
    } catch (connectError) {
      logger.warn('Endpoint /connect não disponível, tentando outros...', connectError.message);
    }

    try {
      // Tentar endpoint alternativo de status
      response = await this.api.get(`/instance/connectionState/${instanceName}`);
      
      if (response.data.qrcode) {
        logger.info('QR Code obtido via /connectionState:', {
          instance: instanceName,
          hasQRCode: true
        });
        return { qrcode: response.data.qrcode, ...response.data };
      }
    } catch (stateError) {
      logger.warn('Endpoint /connectionState não retornou QR Code');
    }

    // Se chegou até aqui, tentar reconectar para gerar novo QR Code
    try {
      response = await this.api.put(`/instance/restart/${instanceName}`);
      
      if (response.data.qrcode) {
        logger.info('QR Code obtido via /restart:', {
          instance: instanceName,
          hasQRCode: true
        });
        return { qrcode: response.data.qrcode, ...response.data };
      }
    } catch (restartError) {
      logger.warn('Endpoint /restart falhou');
    }

    throw new Error('Nenhum endpoint retornou QR Code válido');

  } catch (error) {
    logger.error('Erro ao buscar QR Code da Evolution API:', {
      instance: instanceName,
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
}

async connectInstance(instanceName) {
  try {
    const response = await this.api.get(`/instance/connect/${instanceName}`);
    
    logger.info('Instância conectada:', {
      instance: instanceName,
      status: response.data.instance?.state,
      hasQRCode: !!response.data.qrcode
    });

    return response.data;
  } catch (error) {
    logger.error('Erro ao conectar instância:', error);
    throw error;
  }
}

// Reiniciar instância (NOVO método)
async restartInstance(instanceName) {
  try {
    const response = await this.api.put(`/instance/restart/${instanceName}`);
    
    logger.info('Instância reiniciada:', {
      instance: instanceName,
      hasQRCode: !!response.data.qrcode
    });

    return response.data;
  } catch (error) {
    logger.error('Erro ao reiniciar instância:', error);
    throw error;
  }
}

// Desconectar instância (NOVO método)
async logoutInstance(instanceName) {
  try {
    const response = await this.api.delete(`/instance/logout/${instanceName}`);
    
    logger.info('Instância desconectada:', {
      instance: instanceName
    });

    return response.data;
  } catch (error) {
    logger.error('Erro ao desconectar instância:', error);
    throw error;
  }
}

  // Listar instâncias
  async listInstances() {
    try {
      const response = await this.api.get('/instance/fetchInstances');
      return response.data || [];
    } catch (error) {
      logger.error('Erro ao listar instâncias:', error);
      throw new Error(`Erro ao listar instâncias: ${error.message}`);
    }
  }

  // Configurar webhook
  async setWebhook(instanceName, webhookUrl, events = []) {
    try {
      const webhookData = {
        url: webhookUrl,
        events: events.length > 0 ? events : [
          'APPLICATION_STARTUP',
          'QRCODE_UPDATED', 
          'CONNECTION_UPDATE',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE'
        ]
      };

      const response = await this.api.post(`/webhook/set/${instanceName}`, webhookData);
      return response.data;
    } catch (error) {
      logger.error('Erro ao configurar webhook:', error);
      throw new Error(`Erro ao configurar webhook: ${error.message}`);
    }
  }

  // Restart instância (útil quando QR Code expira)
  async restartInstance(instanceName) {
    try {
      const response = await this.api.post(`/instance/restart/${instanceName}`);
      return response.data;
    } catch (error) {
      logger.error('Erro ao reiniciar instância:', error);
      throw new Error(`Erro ao reiniciar instância: ${error.message}`);
    }
  }

  // Logout instância
  async logoutInstance(instanceName) {
    try {
      const response = await this.api.delete(`/instance/logout/${instanceName}`);
      return response.data;
    } catch (error) {
      logger.error('Erro ao fazer logout da instância:', error);
      throw new Error(`Erro ao fazer logout: ${error.message}`);
    }
  }

  // Gerar token aleatório
  generateToken() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}

module.exports = new EvolutionApiService();