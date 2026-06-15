const logger = require('../utils/logger');
const axios = require('axios');
const WhatsAppInstance = require('../models/WhatsAppInstance');
const fs = require('fs/promises');
const path = require('path');

const GRAPH_API_VERSION = 'v25.0';

function getFilenameFromUrl(url, fallback = 'sample-media') {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '';
    const filename = pathname.split('/').filter(Boolean).pop();
    return filename || fallback;
  } catch (error) {
    return fallback;
  }
}

function getPublicMediaUrlCandidates(sampleUrl) {
  const candidates = [sampleUrl];

  if (sampleUrl.includes('/uploads/')) {
    candidates.push(sampleUrl.replace('/uploads/', '/api/uploads/'));
  }

  if (sampleUrl.includes('/api/uploads/')) {
    candidates.push(sampleUrl.replace('/api/uploads/', '/uploads/'));
  }

  return [...new Set(candidates)];
}

function getMimeTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

async function readLocalUploadedMedia(sampleUrl) {
  try {
    const parsed = new URL(sampleUrl);
    if (!parsed.pathname.includes('/uploads/')) return null;

    const filename = path.basename(parsed.pathname);
    const localPath = path.join(__dirname, '../../public/uploads', filename);
    const buffer = await fs.readFile(localPath);

    return {
      buffer,
      mimeType: getMimeTypeFromFilename(filename),
      filename
    };
  } catch (error) {
    return null;
  }
}

async function downloadPublicMedia(sampleUrl) {
  const candidates = getPublicMediaUrlCandidates(sampleUrl);
  let response;
  let lastError;

  for (const candidateUrl of candidates) {
    try {
      response = await axios.get(candidateUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 300
      });
      sampleUrl = candidateUrl;
      break;
    } catch (error) {
      lastError = error;
      logger.warn('[Template Sample] Falha ao baixar mÃ­dia pÃºblica para aprovaÃ§Ã£o.', {
        sampleUrl: candidateUrl,
        status: error.response?.status,
        message: error.message
      });
    }
  }

  if (!response) {
    const localMedia = await readLocalUploadedMedia(sampleUrl);
    if (localMedia) {
      logger.info('[Template Sample] MÃ­dia de exemplo carregada do volume local de uploads.', {
        sampleUrl,
        filename: localMedia.filename
      });
      return localMedia;
    }

    throw new Error(`NÃ£o foi possÃ­vel acessar a mÃ­dia de exemplo pela URL pÃºblica. Status: ${lastError?.response?.status || 'sem resposta'}. URL: ${sampleUrl}`);
  }

  const contentType = (response.headers['content-type'] || '').split(';')[0].trim();
  if (!contentType || !/^(image|video|application)\//.test(contentType)) {
    throw new Error(`A URL de exemplo precisa retornar um arquivo de mÃ­dia. Content-Type recebido: ${contentType || 'ausente'}.`);
  }

  return {
    buffer: Buffer.from(response.data),
    mimeType: contentType,
    filename: getFilenameFromUrl(sampleUrl)
  };
}

async function createTemplateMediaHandle(instance, sampleUrl) {
  const appId = process.env.META_APP_ID;
  const token = instance.apiCredentials?.token;

  if (!appId) {
    throw new Error('META_APP_ID nÃ£o configurado. NecessÃ¡rio para gerar mÃ­dia de exemplo do template.');
  }

  const { buffer, mimeType, filename } = await downloadPublicMedia(sampleUrl);
  const createSessionUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${appId}/uploads`;

  const sessionResponse = await axios.post(createSessionUrl, null, {
    params: {
      file_name: filename,
      file_length: buffer.length,
      file_type: mimeType,
      access_token: token
    },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000
  });

  const uploadSessionId = sessionResponse.data?.id;
  if (!uploadSessionId) {
    throw new Error('Meta nÃ£o retornou o ID da sessÃ£o de upload da mÃ­dia de exemplo.');
  }

  const uploadResponse = await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${uploadSessionId}`,
    buffer,
    {
      headers: {
        Authorization: `OAuth ${token}`,
        file_offset: '0',
        'Content-Type': mimeType
      },
      maxBodyLength: Infinity,
      timeout: 30000
    }
  );

  const handle = uploadResponse.data?.h;
  if (!handle) {
    throw new Error('Meta nÃ£o retornou o header_handle da mÃ­dia de exemplo.');
  }

  return handle;
}

function extractTemplateVariables(templateComponents) {
  const variables = [];
  const variableRegex = /\{\{([0-9]+)\}\}/g;
  
  templateComponents.forEach(component => {
    // Texto no BODY ou HEADER
    if (['BODY', 'HEADER'].includes(component.type) && component.text) {
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
    
    // VariÃ¡veis em botÃµes (ex: URL dinÃ¢mica)
    if (component.type === 'BUTTONS' && component.buttons) {
      component.buttons.forEach(btn => {
        if (btn.url) {
          const matches = btn.url.match(variableRegex);
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

async function sendIndividualTemplateMessages(instance, templateName, phoneNumbers, templateComponents, contactNames = {}, mediaUrl = null) {
  if (!instance || !instance.apiCredentials?.token || !instance.phoneNumberId) {
    throw new Error('Credenciais da instÃ¢ncia (Token, Phone Number ID) nÃ£o encontradas.');
  }

  const { token } = instance.apiCredentials;
  const results = [];
  
  const variables = extractTemplateVariables(templateComponents);
  logger.info(`[Template] Template "${templateName}" possui ${variables.length} variÃ¡veis, usando envio com parÃ¢metros. MediaURL: ${mediaUrl ? 'Sim' : 'NÃ£o'}`);
  
  for (const phone of phoneNumbers) {
    let components = [];
    const contactName = contactNames[phone] || 'Cliente';
    const defaultValues = generateDefaultValues(variables, contactName);

    try {
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${instance.phoneNumberId}/messages`; 
      
      templateComponents.forEach(templateComp => {
        const componentType = templateComp.type.toLowerCase();

        // 1. Tratamento de CabeÃ§alho de MÃ­dia (Opcional)
        if (componentType === 'header' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateComp.format)) {
            if (mediaUrl) {
                const mediaType = templateComp.format.toLowerCase();
                components.push({
                    type: 'header',
                    parameters: [
                        {
                            type: mediaType,
                            [mediaType]: { link: mediaUrl }
                        }
                    ]
                });
            }
        }

        // 2. Tratamento de VariÃ¡veis de Texto (BODY e HEADER texto)
        const componentVariables = extractTemplateVariables([templateComp]); 
        if (componentVariables.length > 0) {
            const parameters = componentVariables.map(varNum => ({
                type: 'text',
                text: defaultValues[varNum]
            }));
            
            // Verifica se jÃ¡ existe um componente deste tipo (ex: header de mÃ­dia jÃ¡ adicionado)
            // No caso de HEADER com texto E mÃ­dia, a Meta tem regras especÃ­ficas, 
            // mas aqui tratamos o caso mais comum: ou mÃ­dia ou texto com variÃ¡vel.
            let existingComp = components.find(c => c.type === componentType);
            if (existingComp) {
                existingComp.parameters = [...existingComp.parameters, ...parameters];
            } else {
                components.push({
                    type: componentType,
                    parameters: parameters
                });
            }
        }
      });

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

      logger.info(`[Fallback] Enviando template para ${phone} com ${components.length} componentes de parÃ¢metro`);
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
      
      logger.info(`[Fallback] âœ… Template enviado para ${phone} com ${variables.length} variÃ¡veis.`);
      
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
      logger.error(`[Fallback] âŒ Erro ao enviar para ${phone} (${errorData?.code || 'N/A'}):`, {
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
    throw new Error('Credenciais da instÃ¢ncia (Token, Phone Number ID) nÃ£o encontradas.');
  }

  const { token } = instance.apiCredentials;
  const results = [];
  
  for (const phone of phoneNumbers) {
    try {
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${instance.phoneNumberId}/messages`;
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
      logger.info(`[Simple] âœ… Template enviado para ${phone}`);
      
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
      logger.error(`[Simple] âŒ Erro ao enviar para ${phone} (${errorData?.code || 'N/A'}):`, errorData);
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

async function checkApiCompatibility(instance) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instÃ¢ncia (Token, WABA ID) nÃ£o encontradas.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  
  const versionsToTest = [GRAPH_API_VERSION];
  
  for (const version of versionsToTest) {
    try {
      const url = `https://graph.facebook.com/${version}/${wabaId}/marketing_contact_lists`;
      logger.info(`[API Check] Testando versÃ£o: ${version}`);
      
      await axios.post(url, { phone_numbers: ['5511999999999'] }, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 5000
      });
      
      logger.info(`[API Check] âœ… VersÃ£o ${version} compatÃ­vel!`);
      return version;
    } catch (error) {
      if (error.response?.status === 404 || error.response?.data?.error?.code === 2500) {
        logger.info(`[API Check] âŒ VersÃ£o ${version} nÃ£o suporta MM Lite`);
        continue;
      }
      logger.warn(`[API Check] Erro inesperado na versÃ£o ${version}:`, error.response?.data?.error?.message || error.message);
    }
  }
  
  throw new Error('Nenhuma versÃ£o da API suporta MM Lite. Verifique se o WABA ID estÃ¡ migrado ou se as versÃµes da API estÃ£o atualizadas no cÃ³digo.');
}

async function createContactList(instance, phoneNumbers) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instÃ¢ncia (Token, WABA ID) nÃ£o encontradas.');
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
      throw new Error('WABA ID nÃ£o migrado para MM Lite. Ã‰ necessÃ¡rio migrar primeiro.');
    }
    
    const errorMessage = error.response?.data?.error?.message || 'Erro ao criar lista de contatos MM Lite.';
    throw new Error(errorMessage);
  }
}

async function sendMMLiteCampaign(instance, templateName, contactListId) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('Credenciais da instÃ¢ncia (Token, WABA ID) nÃ£o encontradas.');
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
      throw new Error('WABA ID nÃ£o migrado para MM Lite. Ã‰ necessÃ¡rio migrar primeiro.');
    }
    
    const errorMessage = error.response?.data?.error?.message || 'Erro ao disparar campanha MM Lite.';
    throw new Error(errorMessage);
  }
}

async function sendCampaignOrFallback(instance, templateName, phoneNumbers, templateComponents, contactNames = {}, mediaUrl = null) {
  const variables = extractTemplateVariables(templateComponents);
  const hasMediaHeader = templateComponents.some(component =>
    component.type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(component.format)
  );

  if (variables.length > 0 || hasMediaHeader) {
    logger.info('[Dispatch] Template tem variáveis ou mídia. MM Lite não aplicável. Usando envio individual.', {
      variables: variables.length,
      hasMediaHeader,
      hasMediaUrl: !!mediaUrl
    });
    return await sendIndividualTemplateMessages(instance, templateName, phoneNumbers, templateComponents, contactNames, mediaUrl);
  }

  try {
    logger.info('[Dispatch] Template sem variÃ¡veis. Tentando envio via MM Lite.');
    const contactList = await createContactList(instance, phoneNumbers);
    const campaignResult = await sendMMLiteCampaign(instance, templateName, contactList.id);
    
    logger.info(`[Dispatch] âœ… Sucesso via MM Lite. Campanha ID: ${campaignResult.campaign_id}`);
    return { 
      success: true, 
      method: 'MM_LITE', 
      campaign_id: campaignResult.campaign_id, 
      contact_list_id: contactList.id 
    };

  } catch (mmLiteError) {
    logger.warn(`[Dispatch] âŒ Falha no MM Lite. Motivo: ${mmLiteError.message}. Ativando fallback para envio simples.`);
    return await sendSimpleTemplateMessages(instance, templateName, phoneNumbers);
  }
}

async function checkMigrationStatus(instance) {
  if (!instance || !instance.wabaId || !instance.apiCredentials?.token) {
    throw new Error('Credenciais da instÃ¢ncia (Token, WABA ID) nÃ£o encontradas.');
  }
  
  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}`; 
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
    logger.error('[MM Lite] ERRO GRAVE ao buscar WABA ID bÃ¡sico:', error.response?.data?.error);
    throw new Error(`Falha ao verificar status de migraÃ§Ã£o: Token ou WABA ID invÃ¡lido: ${error.response?.data?.error?.message || error.message}`);
  }

  try {
      const compatibleVersion = await checkApiCompatibility(instance);
      responseData.mm_lite_compatibility = `CompatÃ­vel com ${compatibleVersion}`;
      responseData.is_mm_lite_enabled = true;
  } catch (e) {
      responseData.mm_lite_compatibility = e.message;
      responseData.is_mm_lite_enabled = false;
  }
  
  logger.info('[MM Lite] Status de migraÃ§Ã£o (Finalizado):', responseData);
  return responseData;
}

async function submitTemplateForApproval(template, instance, sampleUrl = null) {
  if (!instance || !instance.apiCredentials?.token || !instance.wabaId) {
    throw new Error('InstÃ¢ncia do WhatsApp Oficial ou suas credenciais (Token, WABA ID) nÃ£o foram encontradas.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`;
  let sampleMediaHandle = null;

  // Ordem rigorosa exigida pela Meta em alguns casos: HEADER, BODY, FOOTER, BUTTONS
  const componentOrder = { 'HEADER': 1, 'BODY': 2, 'FOOTER': 3, 'BUTTONS': 4 };
  const sortedComponents = [...template.components].sort((a, b) => {
    return (componentOrder[a.type] || 99) - (componentOrder[b.type] || 99);
  });

  const hasMediaHeader = sortedComponents.some(comp => {
    const { type, format } = comp.toObject ? comp.toObject() : comp;
    return type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format);
  });

  if (hasMediaHeader) {
    if (!sampleUrl) {
      throw new Error('Uma URL de exemplo Ã© obrigatÃ³ria para templates de mÃ­dia.');
    }
    sampleMediaHandle = await createTemplateMediaHandle(instance, sampleUrl);
  }

  const cleanedComponents = sortedComponents.map(comp => {
    const { type, format, text, buttons } = comp.toObject ? comp.toObject() : comp; 
    
    // ForÃ§a o tipo para maiÃºsculo para evitar "invalid parameter" por casing
    const cleanComp = { type: type.toUpperCase() };
    const isMediaHeader = type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format);

    // Apenas HEADER pode ter o campo 'format'
    if (type === 'HEADER' && format) cleanComp.format = format;
    
    // BODY e FOOTER sempre usam 'text'. HEADER sÃ³ usa 'text' se for format TEXT.
    if (['BODY', 'FOOTER'].includes(type) && text) {
      cleanComp.text = text.trim();
    }
    if (type === 'HEADER' && format === 'TEXT' && text) {
      cleanComp.text = text.trim();
    }

    if (type === 'HEADER') {
      if (isMediaHeader) {
        cleanComp.example = {
          header_handle: [sampleMediaHandle]
        };
      } else if (format === 'TEXT' && text) {
        const variableRegex = /\{\{([0-9]+)\}\}/g;
        const matches = text.match(variableRegex);
        if (matches) {
          cleanComp.example = {
            header_text: ['Exemplo']
          };
        }
      }
    }

    if (type === 'BODY' && text) {
      const variableRegex = /\{\{([0-9]+)\}\}/g;
      const matches = text.match(variableRegex);
      if (matches) {
        const uniqueVariables = [...new Set(matches)];
        const exampleValues = uniqueVariables.map((_, index) => `Exemplo${index + 1}`); 
        cleanComp.example = {
          body_text: [exampleValues] // Corpo exige array de arrays
        };
      }
    }

    if (type === 'BUTTONS' && buttons && buttons.length > 0) {
      cleanComp.buttons = buttons.map(btn => {
        const cleanButton = {
          type: btn.type.toUpperCase(),
          text: btn.text.trim()
        };
        if (btn.url) {
          cleanButton.url = btn.url.trim();
          if (btn.url.includes('{{1}}')) {
             cleanButton.example = [
                'https://qualifai.ai/exemplo'
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
    throw new Error('Credenciais da instÃ¢ncia nÃ£o encontradas para deletar o template da Meta.');
  }

  const { token } = instance.apiCredentials;
  const { wabaId } = instance;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?name=${templateName}`;

  try {
    const response = await axios.delete(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    logger.info(`Template '${templateName}' deletado com sucesso da Meta.`);
    return response.data;
  } catch (error) {
    if (error.response?.data?.error?.error_subcode === 32) {
        logger.warn(`Template '${templateName}' nÃ£o foi encontrado na Meta para ser deletado.`);
        return { success: true };
    }
    logger.error('ERRO DETALHADO AO DELETAR DA API DA META:', error.response?.data?.error);
    const errorMessage = error.response?.data?.error?.message || 'Erro ao deletar template da Meta.';
    throw new Error(errorMessage);
  }
}

async function getTemplateStatus(metaTemplateId, instance) {
  if (!instance || !instance.apiCredentials?.token) {
    throw new Error('InstÃ¢ncia do WhatsApp ou token nÃ£o encontrado para verificar o status.');
  }
  const { token } = instance.apiCredentials;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${metaTemplateId}`;

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
    throw new Error('InstÃ¢ncia ou token nÃ£o encontrados para buscar estatÃ­sticas.');
  }

  const { token } = instance.apiCredentials;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${campaignId}/stats`;

  try {
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    logger.info(`[MM Lite] EstatÃ­sticas da campanha ${campaignId} buscadas.`);
    return response.data.data && response.data.data.length > 0 ? response.data.data[0] : {};

  } catch (error) {
    logger.error(`[MM Lite] ERRO DETALHADO (getCampaignStats ${campaignId}):`, error.response?.data?.error);
    const errorMessage = error.response?.data?.error?.message || 'Erro ao buscar estatÃ­sticas da campanha.';
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
