const evolutionApiService = require('../../services/evolutionApiService');
const { getModel } = require('../../utils/modelProvider');
const User = getModel('User');
const WhatsAppInstance = getModel('WhatsAppInstance');
const Conversation = getModel('Conversation');
const logger = require('../../utils/logger');

class EvolutionController {
  // Listar todas as instâncias disponíveis (da Evolution API)
  async listAvailableInstances(req, res) {
    try {
      const userId = req.user.id;

      // Buscar instâncias da Evolution API
      const evolutionInstances = await evolutionApiService.listInstances();
      
      // Buscar instâncias salvas no banco para este usuário
      const userInstances = await WhatsAppInstance.find({ user: userId });
      
      // Mapear instâncias disponíveis
      const availableInstances = evolutionInstances.map(instance => {
        const userInstance = userInstances.find(ui => ui.instanceName === instance.instanceName);
        return {
          instanceName: instance.instanceName,
          status: instance.connectionStatus?.toLowerCase() || 'unknown',
          isUserInstance: !!userInstance,
          userInstanceData: userInstance || null,
          evolutionData: instance
        };
      });

      res.json({
        success: true,
        instances: availableInstances,
        userInstances: userInstances
      });

    } catch (error) {
      logger.error('Erro ao listar instâncias disponíveis:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Conectar em instância existente
  async connectToExistingInstance(req, res) {
    try {
      const { instanceName, phoneNumber } = req.body;
      const userId = req.user.id;

      // Verificar se a instância existe na Evolution API
      const evolutionInstances = await evolutionApiService.listInstances();
      const existingInstance = evolutionInstances.find(inst => inst.instanceName === instanceName);

      if (!existingInstance) {
        return res.status(404).json({ 
          message: 'Instância não encontrada na Evolution API' 
        });
      }

      // Verificar se já está sendo usada por outro usuário
      const instanceInUse = await WhatsAppInstance.findOne({
        instanceName,
        user: { $ne: userId },
        status: { $in: ['connected', 'connecting'] }
      });

      if (instanceInUse) {
        return res.status(400).json({
          message: 'Esta instância já está sendo usada por outro usuário'
        });
      }

      // Buscar ou criar registro no banco
      let whatsappInstance = await WhatsAppInstance.findOne({
        instanceName,
        user: userId
      });

      if (!whatsappInstance) {
        whatsappInstance = new WhatsAppInstance({
          instanceName,
          phoneNumber: phoneNumber || instanceName,
          user: userId,
          status: 'connecting',
          evolutionData: existingInstance
        });
      } else {
        // Atualizar dados existentes
        whatsappInstance.status = 'connecting';
        whatsappInstance.evolutionData = existingInstance;
        whatsappInstance.lastConnection = new Date();
      }

      // Configurar webhook se necessário
      /* try {
        await evolutionApiService.setWebhook(
          instanceName,
          `${process.env.WEBHOOK_BASE_URL}/api/webhooks/evolution/${instanceName}`
        );
      } catch (webhookError) {
        logger.warn('Erro ao configurar webhook (continuando):', webhookError.message);
      } */

      // Tentar conectar se não estiver conectada
      if (existingInstance.connectionStatus?.toLowerCase() !== 'open') {
        try {
          await evolutionApiService.connectInstance(instanceName);
        } catch (connectError) {
          logger.warn('Erro ao conectar instância (continuando):', connectError.message);
        }
      }

      await whatsappInstance.save();

      // Obter status atualizado
      let currentStatus;
      try {
        currentStatus = await evolutionApiService.getInstanceStatus(instanceName);
        whatsappInstance.status = currentStatus.instance?.connectionStatus?.toLowerCase() || 'connecting';
        await whatsappInstance.save();
      } catch (statusError) {
        logger.warn('Erro ao obter status:', statusError.message);
      }

      res.json({
        success: true,
        message: 'Conectado à instância existente com sucesso',
        instance: whatsappInstance,
        currentStatus: currentStatus
      });

    } catch (error) {
      logger.error('Erro ao conectar em instância existente:', error);
      res.status(500).json({ 
        message: error.message || 'Erro interno do servidor' 
      });
    }
  }

  // Criar nova instância OU conectar se já existir
  async createOrConnectInstance(req, res) {
    try {
      const { phoneNumber, instanceName, forceNew = true } = req.body;
      const userId = req.user.id;

      // Gerar nome da instância se não fornecido
      const finalInstanceName = instanceName || `qualifai_${phoneNumber.replace(/\D/g, '')}`;

      // Verificar se já existe instância ativa para este usuário
      const existingUserInstance = await WhatsAppInstance.findOne({ 
        user: userId, 
        status: { $in: ['connected', 'connecting'] } 
      });

      if (existingUserInstance && !forceNew) {
        return res.status(400).json({ 
          message: 'Já existe uma instância ativa para este usuário',
          suggestion: 'Use o endpoint de conexão ou force a criação de uma nova',
          existingInstance: existingUserInstance
        });
      }

      // Verificar se a instância já existe na Evolution API
      const evolutionInstances = await evolutionApiService.listInstances();
      console.log("evolutionInstances:", evolutionInstances);
      console.log(existingUserInstance);
      const existingEvolutionInstance = evolutionInstances.find(
        inst => inst.instanceName === finalInstanceName
      );

      if (existingEvolutionInstance && !forceNew) {
        // Conectar na instância existente
        req.body.instanceName = finalInstanceName;
        return this.connectToExistingInstance(req, res);
      }

      // Criar nova instância
      const evolutionResponse = await evolutionApiService.createInstance(
        finalInstanceName, 
        phoneNumber
      );
      console.log("Evolution Response:", evolutionResponse);
      // Salvar instância no banco (CORRIGIDO)
    const whatsappInstance = new WhatsAppInstance({
      instanceName: finalInstanceName,
      phoneNumber: phoneNumber,
      phoneNumberId: evolutionResponse.instance?.instanceId || finalInstanceName, // USAR instanceId
      user: userId,
      status: 'connecting',
      qrCode: evolutionResponse.qrcode?.base64,
      apiCredentials: {
        token: evolutionResponse.hash?.apikey,
        apiKey: evolutionResponse.hash?.apikey,
        instanceId: evolutionResponse.instance?.instanceId
      },
      evolutionData: evolutionResponse
    });

      console.log("WhatsApp Instance:", whatsappInstance);

      await whatsappInstance.save();
      
      logger.info('✅ Instância criada e salva no banco:', {
      instanceName: finalInstanceName,
      instanceId: evolutionResponse.instance?.instanceId,
      apiKey: evolutionResponse.hash?.apikey
    });

      // Configurar webhook
      /* try {
        await evolutionApiService.setWebhook(
          finalInstanceName,
          `${process.env.WEBHOOK_BASE_URL}/api/webhooks/evolution/${finalInstanceName}`
        );
      } catch (webhookError) {
        logger.warn('Erro ao configurar webhook:', webhookError.message);
      } */

      res.status(201).json({
        success: true,
        message: 'Nova instância criada com sucesso',
        instance: whatsappInstance,
        qrcode: evolutionResponse.qrcode
      });

    } catch (error) {
      logger.error('Erro ao criar/conectar instância:', error);
      res.status(500).json({ 
        message: error.message || 'Erro interno do servidor' 
      });
    }
  }

  // Deletar instância
  async deleteInstance(req, res) {
    try {
      const { instanceName } = req.params;
      const { forceDelete = false } = req.body;
      const userId = req.user.id;

      // Buscar instância no banco
      const instance = await WhatsAppInstance.findOne({
        instanceName,
        user: userId
      });

      if (!instance) {
        return res.status(404).json({ 
          message: 'Instância não encontrada ou não pertence a você' 
        });
      }

      logger.info('Deletando instância:', { instanceName, userId, forceDelete });


      // Verificar se há conversas ativas
      const activeConversations = await Conversation.countDocuments({
        user: userId,
        channel: 'whatsapp',
        status: 'active'
      });

      if (activeConversations > 0 && !forceDelete) {
        return res.status(400).json({
          message: `Existem ${activeConversations} conversas ativas no WhatsApp`,
          suggestion: 'Finalize as conversas ou use forceDelete: true',
          activeConversations
        });
      }

      try {
        // Deletar da Evolution API
        await evolutionApiService.deleteInstance(instanceName);
      } catch (evolutionError) {
        logger.warn('Erro ao deletar da Evolution API:', evolutionError.message);
        // Continua mesmo com erro na Evolution API
      }

      // Atualizar status no banco (não deletar para manter histórico)
      instance.status = 'deleted';
      instance.disconnectedAt = new Date();
      instance.deletedAt = new Date();
      await instance.save();

      // Se forceDelete, finalizar conversas ativas
      if (forceDelete && activeConversations > 0) {
        await Conversation.updateMany(
          {
            user: userId,
            channel: 'whatsapp',
            status: 'active'
          },
          {
            status: 'closed',
            endedAt: new Date()
          }
        );
      }

      res.json({
        success: true,
        message: 'Instância deletada com sucesso',
        deletedConversations: forceDelete ? activeConversations : 0
      });

    } catch (error) {
      logger.error('Erro ao deletar instância:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Reativar instância deletada
  async reactivateInstance(req, res) {
    try {
      const { instanceName } = req.params;
      const userId = req.user.id;

      const instance = await WhatsAppInstance.findOne({
        instanceName,
        user: userId,
        status: 'deleted'
      });

      if (!instance) {
        return res.status(404).json({ 
          message: 'Instância deletada não encontrada' 
        });
      }

      // Verificar se ainda existe na Evolution API
      const evolutionInstances = await evolutionApiService.listInstances();
      const existsInEvolution = evolutionInstances.find(
        inst => inst.instanceName === instanceName
      );

      if (!existsInEvolution) {
        return res.status(400).json({
          message: 'Instância não existe mais na Evolution API',
          suggestion: 'Crie uma nova instância'
        });
      }

      // Reativar
      instance.status = 'connecting';
      instance.deletedAt = undefined;
      instance.lastConnection = new Date();
      await instance.save();

      // Configurar webhook novamente
      try {
        await evolutionApiService.setWebhook(
          instanceName,
          `${process.env.WEBHOOK_BASE_URL}/api/webhooks/evolution/${instanceName}`
        );
      } catch (webhookError) {
        logger.warn('Erro ao configurar webhook:', webhookError.message);
      }

      res.json({
        success: true,
        message: 'Instância reativada com sucesso',
        instance
      });

    } catch (error) {
      logger.error('Erro ao reativar instância:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

 // Deletar completamente (remover do banco)
async permanentDelete(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    // Verificar se instância existe e pertence ao usuário
    const instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    // Só permitir deleção permanente se já estiver marcada como deletada
    if (instance.status !== 'deleted') {
      return res.status(400).json({ 
        message: 'Instância deve ser deletada primeiro antes da remoção permanente' 
      });
    }

    // Deletar conversas relacionadas
    await Conversation.deleteMany({ 
      user: userId,
      messages: { 
        $elemMatch: { 
          channel: 'whatsapp' 
        } 
      }
    });

    // Remover completamente do banco
    await WhatsAppInstance.findByIdAndDelete(instance._id);

    logger.info('Instância removida permanentemente:', { instanceName, userId });

    res.json({ 
      success: true, 
      message: 'Instância removida permanentemente' 
    });

  } catch (error) {
    logger.error('Erro na deleção permanente:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
} 

async fetchQRCode(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    // Buscar instância no banco
    let instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    logger.info('🔍 Buscando QR Code para instância:', { instanceName });

    try {
      // Tentar obter QR Code da Evolution API
      const response = await evolutionApiService.fetchQRCode(instanceName);
      
      if (response.qrcode) {
        // Salvar QR Code no banco
        instance.qrCode = response.qrcode;
        instance.status = 'connecting';
        await instance.save();

        logger.info('✅ QR Code obtido e salvo:', { instanceName });

        return res.json({
          qrCode: response.qrcode,
          status: instance.status,
          instance: response.instance
        });
      } else {
        // Se não tem QR Code, pode estar conectado ou com erro
        if (response.instance?.state === 'open') {
          instance.status = 'connected';
          instance.qrCode = null;
          await instance.save();
          
          return res.json({
            qrCode: null,
            status: 'connected',
            message: 'Instância já está conectada'
          });
        }
      }

    } catch (evolutionError) {
      logger.error('❌ Erro ao buscar QR Code da Evolution API:', {
        instanceName,
        error: evolutionError.message,
        status: evolutionError.response?.status
      });

      // Se erro 404, a instância não existe na Evolution API
      if (evolutionError.response?.status === 404) {
        return res.status(404).json({ 
          message: 'Instância não encontrada na Evolution API',
          error: 'Instância foi removida ou nunca foi criada',
          suggestion: 'Recrie a instância'
        });
      }

      // Para outros erros, tentar reconectar
      try {
        logger.info('🔄 Tentando reconectar instância...');
        const reconnectResponse = await evolutionApiService.restartInstance(instanceName);
        
        if (reconnectResponse.qrcode) {
          instance.qrCode = reconnectResponse.qrcode;
          instance.status = 'connecting';
          await instance.save();

          return res.json({
            qrCode: reconnectResponse.qrcode,
            status: instance.status,
            message: 'QR Code gerado após reconexão'
          });
        }
      } catch (reconnectError) {
        logger.error('❌ Erro ao reconectar:', reconnectError.message);
      }
    }

    // Se chegou até aqui, não conseguiu obter QR Code
    res.json({
      qrCode: instance.qrCode || null,
      status: instance.status,
      message: 'Não foi possível obter QR Code. Tente recriar a instância.',
      error: 'Erro ao obter QR Code: Instância não encontrada na Evolution API',
      suggestion: 'Delete e recrie a instância'
    });

  } catch (error) {
    logger.error('❌ Erro ao buscar QR Code:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
}

async syncInstanceStatus(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    logger.info('🔄 Sincronizando status da instância:', { instanceName, userId });

    // Buscar instância no banco
    const instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    // Buscar status atual na Evolution API
    const evolutionStatus = await evolutionApiService.getInstanceStatus(instanceName);
    logger.info('📊 Status da Evolution API:', evolutionStatus);

    // Atualizar status no banco
    let newStatus = 'disconnected';
    
    if (evolutionStatus.instance?.state === 'open') {
      newStatus = 'connected';
      instance.lastConnection = new Date();
      instance.disconnectedAt = null;
    } else if (evolutionStatus.instance?.state === 'connecting') {
      newStatus = 'connecting';
    } else if (evolutionStatus.instance?.state === 'close') {
      newStatus = 'disconnected';
      instance.disconnectedAt = new Date();
    }

    // Salvar no banco
    instance.status = newStatus;
    await instance.save();

    logger.info('✅ Status sincronizado:', {
      instanceName,
      oldStatus: instance.status,
      newStatus,
      evolutionState: evolutionStatus.instance?.state
    });

    res.json({
      success: true,
      instanceName,
      status: newStatus,
      evolutionData: evolutionStatus
    });

  } catch (error) {
    logger.error('❌ Erro ao sincronizar status:', error);
    res.status(500).json({ 
      message: 'Erro ao sincronizar status',
      error: error.message 
    });
  }
};

 async getQRCode(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    // Verificar se a instância pertence ao usuário
    const instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    // Verificar se a instância está no status correto para QR Code
    if (!['connecting', 'disconnected'].includes(instance.status)) {
      return res.status(400).json({ 
        message: `Instância está ${instance.status}. QR Code só é necessário quando conectando.`,
        currentStatus: instance.status
      });
    }
    console.log("Instance Status:",instance.status);
    try {
      const qrData = await evolutionApiService.getQRCode(instanceName);
      console.log("QR Data:", qrData);  
      // Salvar QR Code na instância para histórico
      instance.qrCode = qrData.base64;
      await instance.save();
      
      res.json({
        success: true,
        qrcode: qrData.qrcode,
        base64: qrData.base64,
        instanceStatus: instance.status
      });

    } catch (qrError) {
      // Se erro ao obter QR, tentar reiniciar a instância
      logger.warn('Erro ao obter QR Code, tentando reiniciar instância:', qrError.message);
      
      try {
        await evolutionApiService.restartInstance(instanceName);
        
        // Aguardar um pouco e tentar novamente
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const qrData = await evolutionApiService.getQRCode(instanceName);
        
        instance.qrCode = qrData.base64;
        instance.status = 'connecting';
        await instance.save();
        
        res.json({
          success: true,
          qrcode: qrData.qrcode,
          base64: qrData.base64,
          message: 'Instância reiniciada e QR Code gerado',
          instanceStatus: instance.status
        });
        
      } catch (restartError) {
        logger.error('Erro ao reiniciar instância:', restartError);
        res.status(500).json({ 
          message: 'Não foi possível obter QR Code. Tente recriar a instância.',
          error: qrError.message,
          suggestion: 'Delete e recrie a instância'
        });
      }
    }

  } catch (error) {
    logger.error('Erro ao obter QR Code:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
}

// Adicionar método para reiniciar instância
async restartInstance(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    const instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    await evolutionApiService.restartInstance(instanceName);
    
    instance.status = 'connecting';
    await instance.save();

    res.json({
      success: true,
      message: 'Instância reiniciada com sucesso'
    });

  } catch (error) {
    logger.error('Erro ao reiniciar instância:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
}

  async getInstanceStatus(req, res) {
    try {
      const { instanceName } = req.params;
      const userId = req.user.id;

      const instance = await WhatsAppInstance.findOne({
        instanceName,
        user: userId
      });

      if (!instance) {
        return res.status(404).json({ message: 'Instância não encontrada' });
      }

      const status = await evolutionApiService.getInstanceStatus(instanceName);
      
      // Atualizar status no banco
      instance.status = status.instance?.connectionStatus?.toLowerCase() || 'disconnected';
      await instance.save();

      res.json({
        success: true,
        status: status,
        instance: instance
      });

    } catch (error) {
      logger.error('Erro ao obter status:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async getUserInstances(req, res) {
    try {
      const userId = req.user.id;

      const instances = await WhatsAppInstance.find({ 
        user: userId,
        status: { $ne: 'deleted' } // Não mostrar deletadas por padrão
      }).sort('-createdAt');

      res.json({
        success: true,
        instances
      });

    } catch (error) {
      logger.error('Erro ao listar instâncias:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async updateWebhook(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    const instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    // Atualizar webhook com a URL correta
    const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/evolution/${instanceName}`;
    
    await evolutionApiService.setWebhook(instanceName, webhookUrl);

    res.json({
      success: true,
      message: 'Webhook atualizado com sucesso',
      webhookUrl
    });

  } catch (error) {
    logger.error('Erro ao atualizar webhook:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
}

// Forçar reconexão (CORRIGIDO)
async reconnect(req, res) {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    // Verificar se instância pertence ao usuário
    const instance = await WhatsAppInstance.findOne({
      instanceName,
      user: userId
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instância não encontrada' });
    }

    logger.info('🔄 Forçando reconexão da instância:', { instanceName });

    try {
      // Tentar reiniciar a instância
      const response = await evolutionApiService.restartInstance(instanceName);
      
      // Atualizar status
      instance.status = 'connecting';
      instance.qrCode = response.qrcode || null;
      await instance.save();

      res.json({
        success: true,
        message: 'Reconexão iniciada com sucesso',
        qrCode: response.qrcode,
        instance: response
      });

    } catch (restartError) {
      logger.error('❌ Erro ao reiniciar instância:', restartError);
      
      // Se falhar, tentar criar nova instância
      try {
        logger.info('🔧 Tentando recriar instância...');
        
        const createResponse = await evolutionApiService.createInstance(instanceName, {
          webhook: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/evolution/${instanceName}`
        });

        instance.status = 'connecting';
        instance.qrCode = createResponse.qrcode || null;
        await instance.save();

        res.json({
          success: true,
          message: 'Instância recriada com sucesso',
          qrCode: createResponse.qrcode,
          instance: createResponse
        });

      } catch (createError) {
        logger.error('❌ Erro ao recriar instância:', createError);
        res.status(500).json({ 
          message: 'Erro ao reconectar instância',
          error: createError.message 
        });
      }
    }

  } catch (error) {
    logger.error('❌ Erro na reconexão:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
}

  async sendMessage(req, res) {
    try {
      const { instanceName } = req.params;
      const { phone, message } = req.body;
      const userId = req.user.id;

      const instance = await WhatsAppInstance.findOne({
        instanceName,
        user: userId,
        status: 'connected'
      });

      if (!instance) {
        return res.status(404).json({ 
          message: 'Instância não encontrada ou não conectada' 
        });
      }

      const result = await evolutionApiService.sendMessage(instanceName, phone, message);

      res.json({
        success: true,
        messageId: result.key?.id,
        result
      });

    } catch (error) {
      logger.error('Erro ao enviar mensagem:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new EvolutionController();