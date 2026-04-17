const { getModel } = require('../../utils/modelProvider');
const MessageTemplate = getModel('MessageTemplate');
const metaTemplateService = require('../../services/metaTemplateService');
const logger = require('../../utils/logger');
const WhatsAppInstance = getModel('WhatsAppInstance');

class MessageTemplateController {
  
  async list(req, res) {
    try {
      const { status, templateType } = req.query;
      const filter = { user: req.user.id };
      
      if (status) filter.status = status;
      if (templateType) filter.templateType = templateType;

      let templates = await MessageTemplate.find(filter).sort({ createdAt: -1 });

      const templatesToSync = templates.filter(
        t => t.status === 'pending_approval' && t.metaTemplateId
      );

      if (templatesToSync.length > 0) {
        logger.info(`[Auto Sync] Encontrados ${templatesToSync.length} templates pendentes para verificação.`);
        const instance = await WhatsAppInstance.findOne({ user: req.user.id, status: 'connected' });
        
        if (instance) {
          const syncPromises = templatesToSync.map(async (template) => {
            try {
              const metaStatusResponse = await metaTemplateService.getTemplateStatus(template.metaTemplateId, instance);
              const newStatusFromMeta = metaStatusResponse.status;
              
              const statusMap = {
                'APPROVED': 'approved', 'REJECTED': 'rejected', 'PENDING_QA': 'pending_approval', 'PAUSED': 'draft'
              };

              const newLocalStatus = statusMap[newStatusFromMeta.toUpperCase()] || template.status;

              if (newLocalStatus !== template.status) {
                template.status = newLocalStatus;
                if (newLocalStatus === 'rejected') {
                  template.rejectionReason = metaStatusResponse.rejection_reason || 'Rejeitado pela Meta (sem motivo informado).';
                } else {
                  template.rejectionReason = undefined;
                }
                await template.save();
                logger.info(`[Auto Sync] Status do template ${template.name} atualizado para ${newLocalStatus}`);

                if (newLocalStatus === 'approved') {
                  const oneSignalService = require('../../services/oneSignalService');
                  oneSignalService.sendPushNotification(
                    req.user.id.toString(),
                    'Oba! Template Aprovado',
                    `Seu template "${template.name}" foi aprovado pela Meta e está pronto para uso.`,
                    { type: 'meta_template', link: '/app/template-message' }
                  );
                }
              }
            } catch (syncError) {
                logger.error(`[Auto Sync] Falha ao sincronizar o template ${template.name}`, { 
                  error: syncError.message, 
                  stack: syncError.stack 
                });
            }
          });

          await Promise.all(syncPromises);
        } else {
          logger.warn(`[Auto Sync] Nenhuma instância conectada encontrada para o usuário ${req.user.id}. Sincronização pulada.`);
        }
      }
      
      res.json(templates);
    } catch (error) {
      logger.error('Erro ao listar templates:', error);
      res.status(500).json({ message: 'Erro ao listar templates.' });
    }
  }

  async create(req, res) {
    try {
      const { name, category, language, components, templateType } = req.body;
      const newTemplate = new MessageTemplate({
        user: req.user.id, name, category, language, components, 
        status: 'draft',
        templateType: templateType || 'conversation',
      });
      await newTemplate.save();
      res.status(201).json(newTemplate);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ message: `O nome de template '${error.keyValue.name}' já está em uso.` });
      }
      logger.error('Erro ao criar template:', error);
      res.status(500).json({ message: 'Erro ao criar template.' });
    }
  }

  // ==========================================================
  //  ✅ FUNÇÃO ADICIONADA (O "Passo 1" do Upload)
  // ==========================================================
  async uploadSampleImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo recebido. Verifique se o campo é "sampleImage".' });
      }

      // Monta a URL pública (requer APP_URL no .env e express.static no app.js)
      const sampleUrl = `${process.env.APP_URL}/uploads/${req.file.filename}`;
      
      logger.info(`[Template Sample] Imagem de amostra salva com sucesso: ${sampleUrl}`);
      
      // Retorna a URL para o frontend usar no "Passo 2"
      res.status(200).json({
        message: 'Imagem de amostra enviada!',
        sampleUrl: sampleUrl,
        filename: req.file.filename
      });
      
    } catch (error) {
      logger.error('Erro ao fazer upload da imagem de amostra:', error);
      res.status(500).json({ message: 'Erro ao processar imagem.' });
    }
  }

  async submitForApproval(req, res) {
    try {
      const { templateId } = req.params;
      const { whatsappInstanceId, sampleUrl } = req.body; 

      const template = await MessageTemplate.findOne({ _id: templateId, user: req.user.id });
      if (!template) return res.status(404).json({ message: 'Template não encontrado.' });
      if (template.status !== 'draft' && template.status !== 'rejected') {
        return res.status(400).json({ message: 'Apenas templates em rascunho ou rejeitados podem ser enviados.' });
      }

      const instance = await WhatsAppInstance.findOne({ _id: whatsappInstanceId, user: req.user.id });
      if (!instance) {
        return res.status(404).json({ message: 'Instância do WhatsApp não encontrada.' });
      }

      const metaResponse = await metaTemplateService.submitTemplateForApproval(template, instance, sampleUrl);
      
      template.wabaId = instance.wabaId;
      template.status = 'pending_approval';
      template.metaTemplateId = metaResponse.id;
      await template.save();
      
      logger.info('Template enviado para aprovação da Meta', { templateId: template._id });
      res.json({ message: 'Template enviado para aprovação!', template });
    } catch (error) {
        logger.error('Erro ao submeter template para Meta:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { templateId } = req.params;
      const { name, category, language, components, templateType } = req.body;

      const template = await MessageTemplate.findOne({ _id: templateId, user: req.user.id });
      if (!template) {
        return res.status(404).json({ message: 'Template não encontrado.' });
      }

      if (!['draft', 'rejected'].includes(template.status)) {
        return res.status(400).json({ message: 'Apenas templates em "Rascunho" ou "Rejeitado" podem ser editados.' });
      }

      template.name = name;
      template.category = category;
      template.language = language;
      template.components = components;
      template.templateType = templateType ?? template.templateType;

      if (template.status === 'rejected') {
        template.status = 'draft';
        template.rejectionReason = undefined;
      }

      await template.save();
      res.json(template);
    } catch (error) {
      logger.error('Erro ao atualizar template:', { error: error.message });
      res.status(500).json({ message: 'Erro ao atualizar template.' });
    }
  }

  async delete(req, res) {
    try {
      const { templateId } = req.params;
      const template = await MessageTemplate.findOne({ _id: templateId, user: req.user.id });
      if (!template) {
        return res.status(404).json({ message: 'Template não encontrado.' });
      }
      
      if (template.metaTemplateId && template.status !== 'draft') {
          const instance = await WhatsAppInstance.findOne({ user: req.user.id, status: 'connected' });
          if (instance) {
              await metaTemplateService.deleteTemplateFromMeta(instance, template.name);
          } else {
              logger.warn(`Nenhuma instância conectada encontrada para o usuário ${req.user.id}, não foi possível deletar o template da Meta.`);
          }
      }
      await MessageTemplate.findByIdAndDelete(templateId);
      res.status(200).json({ message: 'Template deletado com sucesso.' });
    } catch (error) {
      logger.error('Erro ao deletar template:', { error: error.message });
      res.status(500).json({ message: 'Erro ao deletar template.' });
    }
  }

  async resubmit(req, res) {
    try {
        const { templateId } = req.params;
        const { name, category, language, components, whatsappInstanceId, templateType, sampleUrl } = req.body; 
        const userId = req.user.id;

        const originalTemplate = await MessageTemplate.findOne({ _id: templateId, user: userId });
        if (!originalTemplate) {
            return res.status(404).json({ message: 'Template original não encontrado.' });
        }
        const baseName = originalTemplate.name.split('_v')[0];

        const versionsRegex = new RegExp(`^${baseName}(_v(\\d+))?$`);
        const existingVersions = await MessageTemplate.find({ user: userId, name: versionsRegex });

        let maxVersion = 1;
        existingVersions.forEach(t => {
            const match = t.name.match(versionsRegex);
            if (match && match[2]) {
                const versionNum = parseInt(match[2], 10);
                if (versionNum > maxVersion) {
                    maxVersion = versionNum;
                }
            }
        });
        
        const newVersionNumber = maxVersion + 1;
        const newName = `${baseName}_v${newVersionNumber}`;
        
        const newTemplateVersion = new MessageTemplate({
            user: userId,
            name: newName,
            category,
            language,
            components: components,
            status: 'draft',
            templateType: templateType || originalTemplate.templateType || 'conversation',
        });
        await newTemplateVersion.save();

        const instance = await WhatsAppInstance.findOne({ _id: whatsappInstanceId, user: userId });
        if (!instance) {
            return res.status(404).json({ message: 'Instância do WhatsApp não encontrada.' });
        }

        const metaResponse = await metaTemplateService.submitTemplateForApproval(newTemplateVersion, instance, sampleUrl);
        
        newTemplateVersion.status = 'pending_approval';
        newTemplateVersion.metaTemplateId = metaResponse.id;
        newTemplateVersion.wabaId = instance.wabaId;
        await newTemplateVersion.save();

        await MessageTemplate.findByIdAndDelete(templateId);
        logger.info(`Template antigo (${originalTemplate.name}) deletado após reenvio.`);
        
        logger.info('Nova versão do template enviada para aprovação', { newTemplateId: newTemplateVersion._id, newName });
        res.status(201).json({ message: `Nova versão (${newName}) enviada para aprovação!`, template: newTemplateVersion });

    } catch (error) {
        logger.error('Erro ao reenviar nova versão do template:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: error.message });
    }
  }

  async listByInstance(req, res) {
    try {
      const { instanceId } = req.params;
      const userId = req.user.id;
  
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
      if (!instance || !instance.wabaId) {
        return res.status(404).json({ message: 'Instância não encontrada ou não possui WABA ID associado.' });
      }
  
      const templates = await MessageTemplate.find({ 
        user: userId, 
        wabaId: instance.wabaId 
      });
  
      res.json(templates);
    } catch (error) {
      logger.error('Erro ao listar templates por instância:', error);
      res.status(500).json({ message: 'Erro ao buscar templates.' });
    }
  }

  async sendMMLiteCampaign(req, res) {
    const { templateId, instanceId, contacts } = req.body;
    const userId = req.user.id;

    if (!templateId || !instanceId || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ 
        message: 'Parâmetros inválidos. É necessário: templateId, instanceId e um array [contacts] não vazio.' 
      });
    }

    try {
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
      if (!instance || !instance.wabaId) {
        return res.status(404).json({ message: 'Instância do WhatsApp não encontrada ou não configurada corretamente (WABA ID faltando).' });
      }

      const template = await MessageTemplate.findOne({ _id: templateId, user: userId });
      if (!template) {
        return res.status(404).json({ message: 'Template não encontrado.' });
      }
      if (template.status !== 'approved') {
        return res.status(400).json({ message: 'O template precisa estar com status "Aprovado" para ser enviado.' });
      }
      if (template.category !== 'MARKETING') {
        return res.status(400).json({ message: 'MM Lite só pode ser usado com templates da categoria "MARKETING".' });
      }

      logger.info(`[MM Lite] Criando lista de contatos com ${contacts.length} números.`);
      const contactListResponse = await metaTemplateService.createContactList(instance, contacts);
      const contactListId = contactListResponse.id;

      if (!contactListId) {
        throw new Error('Não foi possível obter o ID da lista de contatos da Meta.');
      }

      logger.info(`[MM Lite] Disparando campanha com template ${template.name} para a lista ${contactListId}.`);
      const campaignResponse = await metaTemplateService.sendMMLiteCampaign(
        instance,
        template.name, 
        contactListId
      );

      res.status(200).json({
        message: 'Campanha MM Lite enviada para processamento pela Meta!',
        campaignId: campaignResponse.campaign_id,
        contactListId: contactListId
      });

    } catch (error) {
      logger.error('Erro ao enviar campanha MM Lite:', { error: error.message, stack: error.stack });
      res.status(500).json({ message: error.message || 'Erro interno ao processar campanha MM Lite.' });
    }
  }

  async getCampaignStats(req, res) {
    const { campaignId } = req.params;
    const { instanceId } = req.query; 
    const userId = req.user.id;

    if (!instanceId) {
      return res.status(400).json({ message: 'O parâmetro "instanceId" é obrigatório na query string.' });
    }

    try {
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
      if (!instance) {
        return res.status(404).json({ message: 'Instância não encontrada.' });
      }

      const stats = await metaTemplateService.getCampaignStats(instance, campaignId);

      res.status(200).json(stats);

    } catch (error) {
      logger.error(`[MM Lite] Erro ao buscar estatísticas da campanha ${campaignId}:`, { error: error.message });
      res.status(500).json({ message: error.message || 'Erro interno ao buscar estatísticas.' });
    }
  }

}

module.exports = new MessageTemplateController();