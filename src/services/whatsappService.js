// services/whatsappService.js
const axios = require('axios');
const FormData = require('form-data');
const https = require('https');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const logger = require('../utils/logger'); // Ajuste o caminho se necessário

const API_VERSION = 'v23.0'; // Usando uma versão mais recente
const REQUEST_TIMEOUT = 15000; // Timeout de 15 segundos

// Agente HTTPS para forçar IPv4, ajuda a evitar erros de timeout EADDRNOTAVAIL
const httpsAgent = new https.Agent({ family: 4 });

const getLocalUploadPathFromUrl = (mediaUrl) => {
    try {
        const parsed = new URL(mediaUrl);
        if (!parsed.pathname.includes('/uploads/')) return null;
        const filename = path.basename(parsed.pathname);
        const localPath = path.join(__dirname, '../../public/uploads', filename);
        return fs.existsSync(localPath) ? localPath : null;
    } catch (error) {
        return null;
    }
};

const uploadTemplateMediaToMeta = async (instance, mediaUrl, mediaType) => {
    const token = instance.apiCredentials.token;
    const apiUrl = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/media`;

    // Tenta arquivo local primeiro
    const localPath = getLocalUploadPathFromUrl(mediaUrl);
    if (localPath) {
        const form = new FormData();
        const contentType = mime.lookup(localPath) || `${mediaType}/jpeg`;

        form.append('messaging_product', 'whatsapp');
        form.append('file', fs.createReadStream(localPath), {
            filename: path.basename(localPath),
            contentType
        });

        const response = await axios.post(apiUrl, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${token}`
            },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });

        logger.info('[Template Media] Midia local enviada para a Meta antes do template.', {
            mediaType,
            mediaId: response.data?.id,
            filename: path.basename(localPath)
        });

        return response.data?.id || null;
    }

    // Fallback: Arquivo local não existe, tenta baixar pela URL pública e subir para a Meta
    logger.info('[Template Media] Arquivo local não encontrado. Tentando download remoto.', { mediaUrl });

    // Tenta variações da URL (com e sem /api/)
    const candidates = [mediaUrl];
    if (mediaUrl.includes('/uploads/') && !mediaUrl.includes('/api/uploads/')) {
        candidates.push(mediaUrl.replace('/uploads/', '/api/uploads/'));
    }
    if (mediaUrl.includes('/api/uploads/')) {
        candidates.push(mediaUrl.replace('/api/uploads/', '/uploads/'));
    }

    let downloadBuffer = null;
    let downloadContentType = null;
    let downloadFilename = path.basename(new URL(mediaUrl).pathname);

    for (const candidateUrl of [...new Set(candidates)]) {
        try {
            const downloadResponse = await axios.get(candidateUrl, {
                responseType: 'arraybuffer',
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: status => status >= 200 && status < 300
            });
            downloadBuffer = Buffer.from(downloadResponse.data);
            downloadContentType = (downloadResponse.headers['content-type'] || '').split(';')[0].trim();
            logger.info('[Template Media] Download remoto bem-sucedido.', { candidateUrl, size: downloadBuffer.length });
            break;
        } catch (dlError) {
            logger.warn('[Template Media] Falha ao baixar midia remota.', {
                candidateUrl,
                status: dlError.response?.status,
                message: dlError.message
            });
        }
    }

    if (!downloadBuffer) {
        logger.warn('[Template Media] Nenhuma fonte de midia disponivel (local ou remota). Link original sera mantido.', { mediaUrl });
        return null;
    }

    const finalContentType = downloadContentType || mime.lookup(downloadFilename) || `${mediaType}/jpeg`;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', downloadBuffer, {
        filename: downloadFilename,
        contentType: finalContentType
    });

    const response = await axios.post(apiUrl, form, {
        headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token}`
        },
        httpsAgent,
        timeout: REQUEST_TIMEOUT
    });

    logger.info('[Template Media] Midia remota enviada para a Meta com sucesso.', {
        mediaType,
        mediaId: response.data?.id,
        filename: downloadFilename
    });

    return response.data?.id || null;
};

const normalizeTemplateMediaComponents = async (instance, components = []) => {
    const normalized = JSON.parse(JSON.stringify(components));

    for (const component of normalized) {
        for (const parameter of component.parameters || []) {
            const mediaType = parameter.type;
            if (!['image', 'video', 'document'].includes(mediaType)) continue;

            const mediaPayload = parameter[mediaType];
            if (!mediaPayload?.link || mediaPayload.id) continue;

            try {
                const mediaId = await uploadTemplateMediaToMeta(instance, mediaPayload.link, mediaType);
                if (mediaId) {
                    parameter[mediaType] = { id: mediaId };
                }
            } catch (error) {
                logger.warn('[Template Media] Falha ao subir midia local para a Meta. Enviando por link como fallback.', {
                    mediaType,
                    mediaUrl: mediaPayload.link,
                    error: error.response?.data?.error || error.message
                });
            }
        }
    }

    return normalized;
};

/**
 * Envia uma mensagem de texto simples via WhatsApp.
 */
async function sendTextMessage(instance, to, message) {
    const url = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/messages`;
    const token = instance.apiCredentials.token;
    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
    };
    try {
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });
        
        logger.info('API da Meta respondeu com sucesso para sendTextMessage.', { wamid: response.data?.messages?.[0]?.id });
        return response.data;
    } catch (error) {
        logger.error('Erro detalhado ao enviar mensagem de texto via WhatsApp:', {
            message: error.message, code: error.code, isAxiosError: error.isAxiosError, response: error.response?.data
        });
        throw new Error(`Falha ao enviar mensagem de texto: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * Faz upload de um arquivo de mídia para a API da Meta.
 * (Usado para enviar imagens, áudio, documentos, etc.)
 */
async function uploadMedia(instance, mediaBuffer, mimeType) {
    const url = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/media`;
    const token = instance.apiCredentials.token;
    const form = new FormData();
    form.append('file', mediaBuffer, { filename: 'media.bin', contentType: mimeType }); // Nome de arquivo genérico
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    try {
        const response = await axios.post(url, form, {
            headers: { 'Authorization': `Bearer ${token}`, ...form.getHeaders() },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });
        if (!response.data.id) { throw new Error('Media ID not found in upload response'); }
        logger.info('Upload de mídia para a Meta bem-sucedido.', { mediaId: response.data.id });
        return response.data.id;
    } catch (error) {
        logger.error('Erro detalhado ao fazer upload de mídia para o WhatsApp:', { message: error.message, code: error.code, isAxiosError: error.isAxiosError, response: error.response?.data });
        throw new Error(`Falha ao fazer upload de mídia: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * Envia uma mensagem de áudio usando um ID de mídia.
 */
async function sendAudioMessage(instance, to, mediaId) {
    const url = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/messages`;
    const token = instance.apiCredentials.token;
    const payload = { messaging_product: 'whatsapp', to, type: 'audio', audio: { id: mediaId } };
    try {
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });
        logger.info('API da Meta respondeu com sucesso para sendAudioMessage.');
        return response.data;
    } catch (error) {
        logger.error('Erro detalhado ao enviar mensagem de áudio via WhatsApp:', { message: error.message, code: error.code, isAxiosError: error.isAxiosError, response: error.response?.data });
        throw new Error(`Falha ao enviar mensagem de áudio: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * Obtém a URL de download de uma mídia a partir de seu ID.
 */
async function getMediaUrl(mediaId, token) {
    const url = `https://graph.facebook.com/${API_VERSION}/${mediaId}`;
    try {
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` }, httpsAgent, timeout: REQUEST_TIMEOUT });
        if (!response.data.url) { throw new Error('Media URL not found in response'); }
        logger.info('URL de mídia obtida com sucesso da Meta.');
        return response.data.url;
    } catch (error) {
        logger.error('Erro detalhado ao obter URL de mídia do WhatsApp:', { message: error.message, code: error.code, isAxiosError: error.isAxiosError, response: error.response?.data });
        throw new Error(`Falha ao obter URL de mídia: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * Baixa uma mídia usando sua URL.
 */
async function downloadMedia(mediaUrl, token) {
    try {
        const response = await axios.get(mediaUrl, { headers: { 'Authorization': `Bearer ${token}` }, responseType: 'arraybuffer', httpsAgent, timeout: REQUEST_TIMEOUT });
        logger.info('Download de mídia da Meta bem-sucedido.');
        return Buffer.from(response.data);
    } catch (error) {
        logger.error('Erro detalhado ao baixar mídia do WhatsApp:', { message: error.message, code: error.code, isAxiosError: error.isAxiosError, status: error.response?.status });
        throw new Error(`Falha ao baixar mídia: ${error.message}`);
    }
}

/**
 * Troca um token de acesso de curta duração por um de longa duração.
 */
async function exchangeForLongLivedToken(shortLivedToken) {
  const GRAPH_API_URL = `https://graph.facebook.com/${API_VERSION}`;
  const APP_ID = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;

  try {
    const response = await axios.get(`${GRAPH_API_URL}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken
      },
      httpsAgent,
    });
    return response.data.access_token;
  } catch (error) {
    logger.error('Erro ao trocar token de curta duração por longa duração:', error.response?.data || error.message);
    throw new Error('Falha ao obter token de longa duração.');
  }
}

/**
 * Troca o código de autorização de curta duração por um token de acesso.
 */
async function exchangeCodeForTokensAndInfo(code) {
  try {
    const GRAPH_API_URL = `https://graph.facebook.com/${API_VERSION}`;
    const APP_ID = process.env.META_APP_ID;
    const APP_SECRET = process.env.META_APP_SECRET;

    const tokenResponse = await axios.get(`${GRAPH_API_URL}/oauth/access_token`, {
      params: { client_id: APP_ID, client_secret: APP_SECRET, code },
      httpsAgent,
    });
    const userAccessToken = tokenResponse.data.access_token;
    if (!userAccessToken) {
      throw new Error('Não foi possível obter o token de acesso do usuário da Meta a partir do código.');
    }

    return await getConnectionDetailsFromToken(userAccessToken);
    
  } catch (error) {
    logger.error('Erro no fluxo de troca de código do WhatsApp:', error.response?.data || error.message);
    throw new Error('Falha ao comunicar com a API da Meta para obter detalhes da conta a partir do código.');
  }
}

/**
 * Envia uma mensagem de template via WhatsApp.
 * (Funciona para MARKETING (MM Lite), UTILITY, etc.)
 */
async function sendTemplateMessage(instance, to, templateName, languageCode, components) {
    const url = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/messages`;
    const token = instance.apiCredentials.token;
    const normalizedComponents = components?.length
        ? await normalizeTemplateMediaComponents(instance, components)
        : components;

    const templatePayload = {
        name: templateName,
        language: { code: languageCode || 'pt_BR' }
    };

    if (normalizedComponents && normalizedComponents.length > 0) {
        templatePayload.components = normalizedComponents;
    }
    
    /*
    * Exemplo de 'components' para HEADER de IMAGEM:
    * [
    * {
    * "type": "header",
    * "parameters": [{"type": "image", "image": { "id": "media_id_aqui" }}]
    * },
    * {
    * "type": "body",
    * "parameters": [{"type": "text", "text": "valor_variavel_1"}]
    * }
    * ]
    */

    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: templatePayload
    };

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });
        logger.info('API da Meta respondeu com sucesso para sendTemplateMessage.', { responseData: response.data });
        return response.data;
    } catch (error) {
        logger.error('Erro detalhado ao enviar mensagem de template via WhatsApp:', {
            message: error.message,
            code: error.code,
            isAxiosError: error.isAxiosError,
            response: error.response?.data,
            sentPayload: JSON.stringify(payload) // Loga o payload exato enviado
        });
        throw new Error(`Falha ao enviar mensagem de template: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * *** NOVO ***
 * Envia uma Mensagem de Lista (List Message) interativa (estilo "botão de rádio").
 * Só pode ser usada dentro da janela de 24 horas.
 */
async function sendListMessage(instance, to, headerText, bodyText, buttonText, sections) {
    const url = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/messages`;
    const token = instance.apiCredentials.token;

    /*
    * Exemplo de 'sections':
    * const sections = [
    * {
    * "title": "Título da Seção 1",
    * "rows": [
    * { "id": "id-unico-1", "title": "Opção 1", "description": "Descrição da Opção 1" },
    * { "id": "id-unico-2", "title": "Opção 2", "description": "Descrição da Opção 2" }
    * ]
    * }
    * ]
    */
    
    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
            type: 'list',
            header: {
                type: 'text',
                text: headerText
            },
            body: {
                text: bodyText
            },
            action: {
                button: buttonText, // Ex: "Ver opções"
                sections: sections
            }
        }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });
        logger.info('API da Meta respondeu com sucesso para sendListMessage.');
        return response.data;
    } catch (error) {
        logger.error('Erro detalhado ao enviar mensagem de lista via WhatsApp:', {
            message: error.message, code: error.code, response: error.response?.data, sentPayload: payload
        });
        throw new Error(`Falha ao enviar mensagem de lista: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * *** NOVO ***
 * Envia uma Mensagem com Botões de Resposta Rápida (Reply Buttons).
 * Só pode ser usada dentro da janela de 24 horas.
 */
async function sendReplyButtonsMessage(instance, to, bodyText, buttons) {
    const url = `https://graph.facebook.com/${API_VERSION}/${instance.phoneNumberId}/messages`;
    const token = instance.apiCredentials.token;

    /*
    * Exemplo de 'buttons':
    * const buttons = [
    * { "id": "id-btn-1", "title": "Sim" },
    * { "id": "id-btn-2", "title": "Não" }
    * ]
    */

    const formattedButtons = buttons.slice(0, 3).map(btn => ({
        type: 'reply',
        reply: {
            id: btn.id,
            title: btn.title
        }
    }));
    
    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: {
                text: bodyText
            },
            action: {
                buttons: formattedButtons
            }
        }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            httpsAgent,
            timeout: REQUEST_TIMEOUT
        });
        logger.info('API da Meta respondeu com sucesso para sendReplyButtonsMessage.');
        return response.data;
    } catch (error) {
        logger.error('Erro detalhado ao enviar mensagem com botões via WhatsApp:', {
            message: error.message, code: error.code, response: error.response?.data, sentPayload: payload
        });
        throw new Error(`Falha ao enviar mensagem com botões: ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * Obtém detalhes da conta do WhatsApp Business usando um Access Token.
 */
async function getConnectionDetailsFromToken(accessToken) {
    try {
        const GRAPH_API_URL = `https://graph.facebook.com/${API_VERSION}`;
        const APP_ID = process.env.META_APP_ID;
        const APP_SECRET = process.env.META_APP_SECRET;

        const debugResponse = await axios.get(`${GRAPH_API_URL}/debug_token`, {
            params: { input_token: accessToken, access_token: `${APP_ID}|${APP_SECRET}` },
            httpsAgent,
        });
        const tokenData = debugResponse.data.data;
        if (!tokenData || !tokenData.is_valid) {
            throw new Error('O token de acesso fornecido é inválido.');
        }

        const granularScopes = tokenData.granular_scopes || [];
        const wabaScope = granularScopes.find(scope => scope.scope === 'whatsapp_business_management');
        if (!wabaScope || !wabaScope.target_ids || wabaScope.target_ids.length === 0) {
            throw new Error('Permissão "whatsapp_business_management" ou WABA ID não encontrado no token.');
        }
        const wabaId = wabaScope.target_ids[0];

        let longLivedToken = accessToken;
        // data_access_expires_at === 0 significa que já é de longa duração
        if (tokenData.data_access_expires_at !== 0) { 
            logger.info('Token de curta duração detectado, trocando por um de longa duração.');
            longLivedToken = await exchangeForLongLivedToken(accessToken);
        } else {
            logger.info('Token de longa duração já recebido.');
        }

        const phoneNumbersResponse = await axios.get(`${GRAPH_API_URL}/${wabaId}/phone_numbers`, {
            params: { access_token: longLivedToken },
            httpsAgent,
        });
        const phoneNumbers = phoneNumbersResponse.data?.data;
        if (!phoneNumbers || phoneNumbers.length === 0) {
            logger.warn(`[Meta API] Nenhum número de telefone encontrado para o WABA ID: ${wabaId}.`, { response: phoneNumbersResponse.data });
            throw new Error('Nenhum número de telefone foi encontrado para esta conta do WhatsApp na Meta.');
        }
        
        // Prioriza números já verificados
        const phoneData = phoneNumbers.find(p => p.code_verification_status === 'VERIFIED') || phoneNumbers[0];
        
        const result = {
            accessToken: longLivedToken,
            phoneNumberId: phoneData.id,
            phoneNumber: `+${phoneData.display_phone_number.replace(/\s/g, '')}`,
            displayName: phoneData.verified_name,
            wabaId: wabaId,
        };
        logger.info('Detalhes da conexão com WhatsApp obtidos com sucesso via token.', result);
        return result;

    } catch (error) {
        logger.error('Erro no fluxo de obtenção de token do WhatsApp:', error.response?.data || error.message);
        throw new Error('Falha ao comunicar com a API da Meta para obter detalhes da conta.');
    }
}

/**
 * Registra um número de telefone com a API da Meta Cloud.
 * (PIN é usado para migração, pode ser um PIN fixo ou variável)
 */
async function subscribeWabaToWebhooks(wabaId, token) {
  if (!wabaId || !token) {
    logger.warn('[Meta Webhook] WABA ID ou token ausente. Não foi possível inscrever o app no WABA.', {
      hasWabaId: !!wabaId,
      hasToken: !!token
    });
    return null;
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/subscribed_apps`;

  try {
    const response = await axios.post(url, null, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      timeout: REQUEST_TIMEOUT
    });

    logger.info('[Meta Webhook] App inscrito no WABA para receber webhooks.', {
      wabaId,
      responseData: response.data
    });

    return response.data;
  } catch (error) {
    logger.error('[Meta Webhook] Falha ao inscrever app no WABA.', {
      wabaId,
      message: error.message,
      response: error.response?.data
    });
    throw new Error(`Falha ao inscrever app no WABA: ${error.response?.data?.error?.message || error.message}`);
  }
}

async function registerPhoneNumber(phoneNumberId, token, pin = '000000') {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/register`;
  const payload = {
    messaging_product: 'whatsapp',
    pin: pin,
  };

  try {
    const response = await axios.post(url, payload, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      httpsAgent,
      timeout: REQUEST_TIMEOUT
    });
    logger.info(`Número de telefone ${phoneNumberId} registrado com sucesso na API de Nuvem da Meta.`, { responseData: response.data });
    return response.data;
  } catch (error) {
    logger.error('Erro ao registrar número de telefone na API da Meta:', {
      message: error.message, code: error.code, isAxiosError: error.isAxiosError, response: error.response?.data
    });
    throw new Error(`Falha ao registrar número de telefone: ${error.response?.data?.error?.message || error.message}`);
  }
}

module.exports = {
    sendTextMessage,
    uploadMedia,
    sendAudioMessage,
    getMediaUrl,
    downloadMedia,
    exchangeCodeForTokensAndInfo,
    sendTemplateMessage,
    getConnectionDetailsFromToken,
    subscribeWabaToWebhooks,
    registerPhoneNumber,
    sendListMessage, // <-- EXPORTADO
    sendReplyButtonsMessage // <-- EXPORTADO
};
