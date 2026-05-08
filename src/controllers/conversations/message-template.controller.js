const { getModel } = require('../../utils/modelProvider');
const MessageTemplate = getModel('MessageTemplate');
const metaTemplateService = require('../../services/metaTemplateService');
const logger = require('../../utils/logger');
const WhatsAppInstance = getModel('WhatsAppInstance');

function buildPublicBaseUrl(req) {
  const forwardedProtoHeader = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : (forwardedProtoHeader || '').split(',')[0].trim();
  const requestProto = forwardedProto || req.protocol || 'http';
  const requestHost = req.headers['x-forwarded-host'] || req.get('host');

  let baseUrl = (process.env.APP_URL || `${requestProto}://${requestHost}`).replace(/\/$/, '');

  if (process.env.NODE_ENV === 'production' && /^http:\/\//i.test(baseUrl)) {
    baseUrl = baseUrl.replace(/^http:\/\//i, 'https://');
  }

  return baseUrl;
}

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
        logger.info(`[Auto Sync] Encontrados ${templatesToSync.length} templates pendentes para verificaÃ§Ã£o.`);
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
                    `Seu template "${template.name}" foi aprovado pela Meta e estÃ¡ pronto para uso.`,
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
          logger.warn(`[Auto Sync] Nenhuma instÃ¢ncia conectada encontrada para o usuÃ¡rio ${req.user.id}. SincronizaÃ§Ã£o pulada.`);
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
        return res.status(400).json({ message: `O nome de template '${error.keyValue.name}' jÃ¡ estÃ¡ em uso.` });
      }
      logger.error('Erro ao criar template:', error);
      res.status(500).json({ message: 'Erro ao criar template.' });
    }
  }

  // ==========================================================
  //  âœ… FUNÃ‡ÃƒO ADICIONADA (O "Passo 1" do Upload)
  // ==========================================================
  async uploadSampleImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo recebido. Verifique se o campo Ã© "sampleImage".' });
      }

      const publicBaseUrl = buildPublicBaseUrl(req);
      const sampleUrl = `${publicBaseUrl}/uploads/${req.file.filename}`;
      
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
      if (!template) return res.status(404).json({ message: 'Template nÃ£o encontrado.' });
      if (template.status !== 'draft' && template.status !== 'rejected') {
        return res.status(400).json({ message: 'Apenas templates em rascunho ou rejeitados podem ser enviados.' });
      }

      const instance = await WhatsAppInstance.findOne({ _id: whatsappInstanceId, user: req.user.id });
      if (!instance) {
        return res.status(404).json({ message: 'InstÃ¢ncia do WhatsApp nÃ£o encontrada.' });
      }

      const metaResponse = await metaTemplateService.submitTemplateForApproval(template, instance, sampleUrl);
      
      template.wabaId = instance.wabaId;
      template.status = 'pending_approval';
      template.metaTemplateId = metaResponse.id;
      await template.save();
      
      logger.info('Template enviado para aprovaÃ§Ã£o da Meta', { templateId: template._id });
      res.json({ message: 'Template enviado para aprovaÃ§Ã£o!', template });
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
        return res.status(404).json({ message: 'Template nÃ£o encontrado.' });
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
        return res.status(404).json({ message: 'Template nÃ£o encontrado.' });
      }
      
      if (template.metaTemplateId && template.status !== 'draft') {
          const instance = await WhatsAppInstance.findOne({ user: req.user.id, status: 'connected' });
          if (instance) {
              await metaTemplateService.deleteTemplateFromMeta(instance, template.name);
          } else {
              logger.warn(`Nenhuma instÃ¢ncia conectada encontrada para o usuÃ¡rio ${req.user.id}, nÃ£o foi possÃ­vel deletar o template da Meta.`);
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
            return res.status(404).json({ message: 'Template original nÃ£o encontrado.' });
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
            return res.status(404).json({ message: 'InstÃ¢ncia do WhatsApp nÃ£o encontrada.' });
        }

        const metaResponse = await metaTemplateService.submitTemplateForApproval(newTemplateVersion, instance, sampleUrl);
        
        newTemplateVersion.status = 'pending_approval';
        newTemplateVersion.metaTemplateId = metaResponse.id;
        newTemplateVersion.wabaId = instance.wabaId;
        await newTemplateVersion.save();

        await MessageTemplate.findByIdAndDelete(templateId);
        logger.info(`Template antigo (${originalTemplate.name}) deletado apÃ³s reenvio.`);
        
        logger.info('Nova versÃ£o do template enviada para aprovaÃ§Ã£o', { newTemplateId: newTemplateVersion._id, newName });
        res.status(201).json({ message: `Nova versÃ£o (${newName}) enviada para aprovaÃ§Ã£o!`, template: newTemplateVersion });

    } catch (error) {
        logger.error('Erro ao reenviar nova versÃ£o do template:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: error.message });
    }
  }

  async listByInstance(req, res) {
    try {
      const { instanceId } = req.params;
      const userId = req.user.id;
  
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
      if (!instance || !instance.wabaId) {
        return res.status(404).json({ message: 'InstÃ¢ncia nÃ£o encontrada ou nÃ£o possui WABA ID associado.' });
      }
  
      const templates = await MessageTemplate.find({ 
        user: userId, 
        wabaId: instance.wabaId 
      });
  
      res.json(templates);
    } catch (error) {
      logger.error('Erro ao listar templates por instÃ¢ncia:', error);
      res.status(500).json({ message: 'Erro ao buscar templates.' });
    }
  }

  async sendMMLiteCampaign(req, res) {
    const { templateId, instanceId, contacts } = req.body;
    const userId = req.user.id;

    if (!templateId || !instanceId || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ 
        message: 'ParÃ¢metros invÃ¡lidos. Ã‰ necessÃ¡rio: templateId, instanceId e um array [contacts] nÃ£o vazio.' 
      });
    }

    try {
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
      if (!instance || !instance.wabaId) {
        return res.status(404).json({ message: 'InstÃ¢ncia do WhatsApp nÃ£o encontrada ou nÃ£o configurada corretamente (WABA ID faltando).' });
      }

      const template = await MessageTemplate.findOne({ _id: templateId, user: userId });
      if (!template) {
        return res.status(404).json({ message: 'Template nÃ£o encontrado.' });
      }
      if (template.status !== 'approved') {
        return res.status(400).json({ message: 'O template precisa estar com status "Aprovado" para ser enviado.' });
      }
      if (template.category !== 'MARKETING') {
        return res.status(400).json({ message: 'MM Lite sÃ³ pode ser usado com templates da categoria "MARKETING".' });
      }

      logger.info(`[MM Lite] Criando lista de contatos com ${contacts.length} nÃºmeros.`);
      const contactListResponse = await metaTemplateService.createContactList(instance, contacts);
      const contactListId = contactListResponse.id;

      if (!contactListId) {
        throw new Error('NÃ£o foi possÃ­vel obter o ID da lista de contatos da Meta.');
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
      return res.status(400).json({ message: 'O parÃ¢metro "instanceId" Ã© obrigatÃ³rio na query string.' });
    }

    try {
      const instance = await WhatsAppInstance.findOne({ _id: instanceId, user: userId });
      if (!instance) {
        return res.status(404).json({ message: 'InstÃ¢ncia nÃ£o encontrada.' });
      }

      const stats = await metaTemplateService.getCampaignStats(instance, campaignId);

      res.status(200).json(stats);

    } catch (error) {
      logger.error(`[MM Lite] Erro ao buscar estatÃ­sticas da campanha ${campaignId}:`, { error: error.message });
      res.status(500).json({ message: error.message || 'Erro interno ao buscar estatÃ­sticas.' });
    }
  }

}

module.exports = new MessageTemplateController();
