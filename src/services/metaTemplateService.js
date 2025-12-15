const logger = require('../utils/logger');
const axios = require('axios');
const WhatsAppInstance = require('../models/WhatsAppInstance');

function extractTemplateVariables(templateComponents) {
  const variables = [];
  
  templateComponents.forEach(component => {
    if (['BODY', 'HEADER'].includes(component.type) && component.text) {
      const variableRegex = /\{\{([0-9]+)\}\}/g;
      const matches = component.text.match(variableRegex);
      if (matches) {
        matches.forEach(match => {
          const varNumber = match.replace(/\{\{|\}\}/g, '');
          if (!variables.includes(varNumber)) {
            variables.push(varNumber);
          }
        });
      }
    }
  });
  
  return variables.sort((a, b) => parseInt(a) - parseInt(b));
}

function generateDefaultValues(variables, contactName = 'Cliente') {
  const values = {};
  variables.forEach((varNum) => {
    switch(parseInt(varNum)) {
      case 1:
        values[varNum] = contactName;
        break;
      default:
        values[varNum] = `Valor_Var_${varNum}`; 
    }
  });
  return values;
}

async function sendIndividualTemplateMessages(instance, templateName, phoneNumbers, templateComponents, contactNames = {}) {
  if (!instance || !instance.apiCredentials?.token || !instance.phoneNumberId) {
    throw new Error('Credenciais da instância (Token, Phone Number ID) não encontradas.');
  }

  const { token } = instance.apiCredentials;
  const results = [];
  
  const variables = extractTemplateVariables(templateComponents);
  logger.info(`[Template] Template "${templateName}" possui ${variables.length} variáveis, usando envio com parâmetros:`, variables);
  
  for (const phone of phoneNumbers) {
    let components = [];
    const contactName = contactNames[phone] || 'Cliente';
    const defaultValues = generateDefaultValues(variables, contactName);

    try {
      const url = `https://graph.facebook.com/v19.0/${instance.phoneNumberId}/messages`; 
      
      if (variables.length > 0) {
        templateComponents.forEach(templateComp => {
            const componentType = templateComp.type.toLowerCase();
            const componentVariables = extractTemplateVariables([templateComp]); 
            
            if (componentVariables.length > 0) {
                const parameters = componentVariables.map(varNum => ({
                    type: 'text',
                    text: defaultValues[varNum]
                }));
                
                components.push({
                    type: componentType,
                    parameters: parameters
                });
            }
        });
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'pt_BR' },
          components: components.length > 0 ? components : undefined 
        }
      };

      logger.info(`[Fallback] Enviando template para ${phone} com ${components.length} componentes de parâmetro`);
      const response = await axios.post(url, payload, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      results.push({ 
        phone, 
        success: true, 
        method: 'INDIVIDUAL',
        messageId: response.data.messages?.[0]?.id,
        variablesUsed: variables.length > 0 ? generateDefaultValues(variables, contactNames[phone]) : null
      });
      
      logger.info(`[Fallback] ✅ Template enviado para ${phone} com ${variables.length} variáveis.`);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      const errorData = error.response?.data?.error;
      results.push({ 
        phone, 
        success: false, 
        method: 'INDIVIDUAL',
        error: errorData?.message || error.message,
        errorDetails: errorData
      });
      logger.error(`[Fallback] ❌ Erro ao enviar para ${phone} (${errorData?.code || 'N/A'}):`, {
        message: errorData?.message,
        details: errorData?.error_data?.details
      });
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

async function sendSimpleTemplateMessages(instance, templateName, phoneNumbers) {
  if (!instance || !instance.apiCredentials?.token || !instance.phoneNumberId) {
    throw new Error('Credenciais da instância (Token, Phone Number ID) não encontradas.');
  }

  const { token } = instance.apiCredentials;
  const results = [];
  
  for (const phone of phoneNumbers) {
    try {
      const url = `https://graph.facebook.com/v19.0/${instance.phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'pt_BR' }
        }
      };

      const response = await axios.post(url, payload, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      results.push({ phone, success: true, method: 'SIMPLE_FALLBACK', messageId: response.data.messages?.[0]?.id });
      logger.info(`[Simple] ✅ Template enviado para ${phone}`);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      const errorData = error.response?.data?.error;
      results.push({ 
        phone, 
        success: false, 
        method: 'SIMPLE_FALLBACK',
        error: errorData?.message || error.message,
        errorDetails: errorData
      });
      logger.error(`[Simple] ❌ Erro ao enviar para ${phone} (${errorData?.code || 'N/A'}):`, errorData);
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

async function checkApiCompatibility(instance) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instância (Token, WABA ID) não encontradas.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  
  const versionsToTest = ['v25.0', 'v24.0', 'v23.0', 'v22.0', 'v21.0', 'v20.0', 'v19.0'];
  
  for (const version of versionsToTest) {
    try {
      const url = `https://graph.facebook.com/${version}/${wabaId}/marketing_contact_lists`;
      logger.info(`[API Check] Testando versão: ${version}`);
      
      await axios.post(url, { phone_numbers: ['5511999999999'] }, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 5000
      });
      
      logger.info(`[API Check] ✅ Versão ${version} compatível!`);
      return version;
    } catch (error) {
      if (error.response?.status === 404 || error.response?.data?.error?.code === 2500) {
        logger.info(`[API Check] ❌ Versão ${version} não suporta MM Lite`);
        continue;
      }
      logger.warn(`[API Check] Erro inesperado na versão ${version}:`, error.response?.data?.error?.message || error.message);
    }
  }
  
  throw new Error('Nenhuma versão da API suporta MM Lite. Verifique se o WABA ID está migrado ou se as versões da API estão atualizadas no código.');
}

async function createContactList(instance, phoneNumbers) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instância (Token, WABA ID) não encontradas.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  
  const compatibleVersion = await checkApiCompatibility(instance);
  const url = `https://graph.facebook.com/${compatibleVersion}/${wabaId}/marketing_contact_lists`;

  const payload = {
    phone_numbers: phoneNumbers
  };

  try {
    const response = await axios.post(url, payload, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    
    logger.info(`[MM Lite] Lista de contatos criada com ID: ${response.data.id} usando API ${compatibleVersion}`);
    return response.data;
  
  } catch (error) {
    logger.error('[MM Lite] ERRO DETALHADO (createContactList):', error.response?.data?.error);
    
    if (error.response?.data?.error?.code === 2429006) {
      throw new Error('WABA ID não migrado para MM Lite. É necessário migrar primeiro.');
    }
    
    const errorMessage = error.response?.data?.error?.message || 'Erro ao criar lista de contatos MM Lite.';
    throw new Error(errorMessage);
  }
}

async function sendMMLiteCampaign(instance, templateName, contactListId) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instância (Token, WABA ID) não encontradas.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  
  const compatibleVersion = await checkApiCompatibility(instance); 
  const url = `https://graph.facebook.com/${compatibleVersion}/${wabaId}/marketing_messages`;

  const payload = {
    template_name: templateName,
    contact_list_id: contactListId
  };

  try {
    const response = await axios.post(url, payload, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    logger.info(`[MM Lite] Campanha disparada com ID: ${response.data.campaign_id} usando API ${compatibleVersion}`);
    return response.data;

  } catch (error) {
    logger.error('[MM Lite] ERRO DETALHADO (sendMMLiteCampaign):', error.response?.data?.error);
    
    if (error.response?.data?.error?.code === 2429006) {
      throw new Error('WABA ID não migrado para MM Lite. É necessário migrar primeiro.');
    }
    
    const errorMessage = error.response?.data?.error?.message || 'Erro ao disparar campanha MM Lite.';
    throw new Error(errorMessage);
  }
}

async function sendCampaignOrFallback(instance, templateName, phoneNumbers, templateComponents, contactNames = {}) {
  const variables = extractTemplateVariables(templateComponents);

  if (variables.length > 0) {
    logger.info('[Dispatch] Template tem variáveis. MM Lite não aplicável. Usando envio individual.');
    return await sendIndividualTemplateMessages(instance, templateName, phoneNumbers, templateComponents, contactNames);
  }

  try {
    logger.info('[Dispatch] Template sem variáveis. Tentando envio via MM Lite.');
    const contactList = await createContactList(instance, phoneNumbers);
    const campaignResult = await sendMMLiteCampaign(instance, templateName, contactList.id);
    
    logger.info(`[Dispatch] ✅ Sucesso via MM Lite. Campanha ID: ${campaignResult.campaign_id}`);
    return { 
      success: true, 
      method: 'MM_LITE', 
      campaign_id: campaignResult.campaign_id, 
      contact_list_id: contactList.id 
    };

  } catch (mmLiteError) {
    logger.warn(`[Dispatch] ❌ Falha no MM Lite. Motivo: ${mmLiteError.message}. Ativando fallback para envio simples.`);
    return await sendSimpleTemplateMessages(instance, templateName, phoneNumbers);
  }
}

async function checkMigrationStatus(instance) {
  if (!instance || !instance.wabaId || !instance.apiCredentials?.token) {
    throw new Error('Credenciais da instância (Token, WABA ID) não encontradas.');
  }
  
  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  const url = `https://graph.facebook.com/v19.0/${wabaId}`; 
  let responseData = {};

  try {
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: {
        fields: 'id,name,message_template_namespace' 
      }
    });
    responseData = response.data;

  } catch (error) {
    logger.error('[MM Lite] ERRO GRAVE ao buscar WABA ID básico:', error.response?.data?.error);
    throw new Error(`Falha ao verificar status de migração: Token ou WABA ID inválido: ${error.response?.data?.error?.message || error.message}`);
  }

  try {
      const compatibleVersion = await checkApiCompatibility(instance);
      responseData.mm_lite_compatibility = `Compatível com ${compatibleVersion}`;
      responseData.is_mm_lite_enabled = true;
  } catch (e) {
      responseData.mm_lite_compatibility = e.message;
      responseData.is_mm_lite_enabled = false;
  }
  
  logger.info('[MM Lite] Status de migração (Finalizado):', responseData);
  return responseData;
}

async function submitTemplateForApproval(template, instance, sampleUrl = null) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Instância do WhatsApp Oficial ou suas credenciais (Token, WABA ID) não foram encontradas.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  const url = `https://graph.facebook.com/v19.0/${wabaId}/message_templates`;

  const headerComponent = template.components.find(c => c.type === 'HEADER');
  const isMediaHeader = headerComponent && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComponent.format);

  const cleanedComponents = template.components.map(comp => {
    const { type, format, text, buttons } = comp.toObject ? comp.toObject() : comp; 
    
    const cleanComp = { type };
    if (format) cleanComp.format = format;
    if (text) cleanComp.text = text;

    if (type === 'HEADER' && isMediaHeader) {
      if (!sampleUrl) {
        throw new Error('Uma URL de exemplo é obrigatória para templates de mídia.');
      }
      cleanComp.example = {
        header_url: [sampleUrl] 
      };
    }

    if (type === 'BODY' && text) {
      const variableRegex = /\{\{([0-9]+)\}\}/g;
      const matches = text.match(variableRegex);
      if (matches) {
        const uniqueVariables = [...new Set(matches)];
        const exampleValues = uniqueVariables.map((_, index) => `Exemplo${index + 1}`); 
        cleanComp.example = {
          body_text: exampleValues 
        };
      }
    }

    if (buttons) {
      cleanComp.buttons = buttons.map(btn => {
        const cleanButton = {
          type: btn.type,
          text: btn.text
        };
        if (btn.url) {
          cleanButton.url = btn.url;
          if (btn.url.includes('{{1}}')) {
             cleanButton.example = [
                'valor_exemplo_url'
             ];
          }
        }
        return cleanButton;
      });
    }
    
    return cleanComp;
  });

  const payload = {
    name: template.name,
    language: template.language,
    category: template.category,
    components: cleanedComponents,
  };
  
  logger.info('Enviando payload final para a Meta (submitTemplateForApproval):', { payload });

  try {
    const response = await axios.post(url, payload, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    return response.data;
  } catch (error) {
    logger.error('ERRO DETALHADO DA API DA META (submit):', error.response?.data?.error);
    const errorMessage = error.response?.data?.error?.message || 'Erro ao comunicar com a API da Meta.';
    throw new Error(errorMessage);
  }
}

async function deleteTemplateFromMeta(instance, templateName) {
  if (!instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instância não encontradas para deletar o template da Meta.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  const url = `https://graph.facebook.com/v19.0/${wabaId}/message_templates?name=${templateName}`;

  try {
    const response = await axios.delete(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    logger.info(`Template '${templateName}' deletado com sucesso da Meta.`);
    return response.data;
  } catch (error) {
    if (error.response?.data?.error?.error_subcode === 32) {
        logger.warn(`Template '${templateName}' não foi encontrado na Meta para ser deletado.`);
        return { success: true };
    }
    logger.error('ERRO DETALHADO AO DELETAR DA API DA META:', error.response?.data?.error);
    const errorMessage = error.response?.data?.error?.message || 'Erro ao deletar template da Meta.';
    throw new Error(errorMessage);
  }
}

async function getTemplateStatus(metaTemplateId, instance) {
  if (!instance || !instance.apiCredentials?.token) {
    throw new Error('Instância do WhatsApp ou token não encontrado para verificar o status.');
  }
  const { token } = instance.apiCredentials;
  const url = `https://graph.facebook.com/v19.0/${metaTemplateId}`;

  try {
    const statusResponse = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: {
        fields: 'status,quality_score'
      }
    });

    const data = statusResponse.data;

    if (data.status === 'REJECTED') {
      try {
        const reasonResponse = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: {
            fields: 'rejection_reason'
          }
        });
        
        if (reasonResponse.data && reasonResponse.data.rejection_reason) {
          data.rejection_reason = reasonResponse.data.rejection_reason;
        }

      } catch (reasonError) {
        logger.warn(`[Auto Sync] Template ${metaTemplateId} foi REJECTED sem um 'rejection_reason'.`, {
          error: reasonError.response?.data?.error
        });
      }
    }

    logger.info(`Status do template ${metaTemplateId} buscado com sucesso.`, data);
    return data;

  } catch (error) {
    logger.error(`ERRO DETALHADO AO BUSCAR STATUS (template ${metaTemplateId}):`, error.response?.data?.error);
    const errorMessage = error.response?.data?.error?.message || 'Erro ao buscar status na API da Meta.';
    throw new Error(errorMessage);
  }
}

async function getCampaignStats(instance, campaignId) {
  if (!instance || !instance.apiCredentials?.token) {
    throw new Error('Instância ou token não encontrados para buscar estatísticas.');
  }

  const { token } = instance.apiCredentials;
  const url = `https://graph.facebook.com/v19.0/${campaignId}/stats`;

  try {
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    logger.info(`[MM Lite] Estatísticas da campanha ${campaignId} buscadas.`);
    return response.data.data && response.data.data.length > 0 ? response.data.data[0] : {};

  } catch (error) {
    logger.error(`[MM Lite] ERRO DETALHADO (getCampaignStats ${campaignId}):`, error.response?.data?.error);
    const errorMessage = error.response?.data?.error?.message || 'Erro ao buscar estatísticas da campanha.';
    throw new Error(errorMessage);
  }
}


module.exports = {
  submitTemplateForApproval,
  deleteTemplateFromMeta,
  getTemplateStatus,
  createContactList,
  sendMMLiteCampaign,
  getCampaignStats,
  checkMigrationStatus,
  sendCampaign: sendCampaignOrFallback,
  sendIndividualTemplateMessages,
  sendSimpleTemplateMessages,
  extractTemplateVariables,
  generateDefaultValues
};