const axios = require('axios');
const logger = require('../utils/logger');
const integrationUtils = require('./integrationUtils');
const User = require('../models/User');

class KommoService {
    // === Kommo CRM Integration ===
    async _getKommoAccessToken(config, userId) {
        if (!userId) {
            throw new Error("[Kommo] userId é obrigatório para atualizar o token.");
        }
        const url = `https://${config.subdomain}.kommo.com/oauth2/access_token`;
        const data = {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: config.refreshToken,
        };

        try {
            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' }
            });

            const newAccessToken = response.data.access_token;
            const newRefreshToken = response.data.refresh_token;

            if (newRefreshToken && newRefreshToken !== config.refreshToken) {
                logger.info(`[Kommo] Refresh token rotacionado para o usuário ${userId}. Atualizando...`);

                await User.findByIdAndUpdate(userId, {
                    'settings.integrations.kommo.refreshToken': newRefreshToken
                });

                // Atualiza o objeto de configuração em memória para o fluxo da requisição atual
                config.refreshToken = newRefreshToken;
            }

            return newAccessToken;
        } catch (error) {
            if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
                logger.error(`[Kommo] Refresh token inválido para o usuário ${userId}. Desativando a integração. O usuário precisa se autenticar novamente.`);

                await User.findByIdAndUpdate(userId, {
                    'settings.integrations.kommo.enabled': false,
                });
            }
            throw error;
        }
    }

    async exchangeCodeForTokens(code, subdomain, clientId, clientSecret) {
        const url = `https://${subdomain}.kommo.com/oauth2/access_token`;
        const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/integrations/kommo/callback`;

        const data = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri
        };
        try {
            const response = await axios.post(url, data, { headers: { 'Content-Type': 'application/json' } });
            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
            };
        } catch (error) {
            logger.error('[Kommo] Erro ao trocar código de autorização por tokens:', error.response?.data || error.message);
            throw new Error('Falha ao obter tokens da Kommo. Verifique o código de autorização e as credenciais do app.');
        }
    }

    createOrUpdateKommoContact = async (leadData, userSettings) => {
        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({
            baseURL: `https://${config.subdomain}.kommo.com`,
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        // Search for contact by email
        const searchResponse = await api.get('/api/v4/contacts', { params: { query: leadData.email } });
        const existingContact = searchResponse.data?._embedded?.contacts?.[0];

        const custom_fields_values = [];
        if (leadData.email) {
            custom_fields_values.push({
                field_code: 'EMAIL',
                values: [{ value: leadData.email, enum_code: 'WORK' }]
            });
        }
        if (leadData.phone) {
            custom_fields_values.push({
                field_code: 'PHONE',
                values: [{ value: leadData.phone, enum_code: 'WORK' }]
            });
        }

        const contactPayload = {
            name: leadData.name,
            first_name: integrationUtils.extractFirstName(leadData.name),
            last_name: integrationUtils.extractLastName(leadData.name),
            custom_fields_values
        };

        if (existingContact) {
            // Update existing contact
            const updateResponse = await api.patch(`/api/v4/contacts/${existingContact.id}`, contactPayload);
            logger.info(`[Kommo] Contato atualizado: ${updateResponse.data.id}`);
            return { id: updateResponse.data.id };
        } else {
            // Create new contact
            const createResponse = await api.post('/api/v4/contacts', [contactPayload]);
            const contactId = createResponse.data._embedded.contacts[0].id;
            logger.info(`[Kommo] Contato criado: ${contactId}`);
            return { id: contactId };
        }
    }

    createKommoDeal = async (leadData, userSettings) => {
        const contactId = Number(leadData.kommo?.id);
        if (!contactId || isNaN(contactId)) {
            logger.warn(`[Kommo] Tentativa de criar deal com ID de contato inválido do Kommo: ${leadData.kommo?.id}. Lead ID: ${leadData._id}`);
            return;
        }

        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({ baseURL: `https://${config.subdomain}.kommo.com`, headers: { 'Authorization': `Bearer ${accessToken}` } });

        const dealPayload = [{
            name: `Deal - ${leadData.name} (${leadData.company})`,
            _embedded: {
                contacts: [{ id: contactId }]
            }
        }];

        const response = await api.post('/api/v4/leads', dealPayload);
        const dealId = response.data._embedded.leads[0].id;
        logger.info(`[Kommo] Deal (Lead) criado: ${dealId}`);
        return { dealId };
    }

    createKommoNote = async (leadData, conversationData, userSettings) => {
        const dealId = leadData.kommo?.dealId ? Number(leadData.kommo.dealId) : null;
        const contactId = leadData.kommo?.id ? Number(leadData.kommo.id) : null;

        if (!dealId && !contactId) {
            logger.warn(`[Kommo] Tentativa de criar nota sem um ID de deal ou contato do Kommo. Lead ID: ${leadData._id}`);
            return;
        }

        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({ baseURL: `https://${config.subdomain}.kommo.com`, headers: { 'Authorization': `Bearer ${accessToken}` } });

        const noteContent = integrationUtils.createNoteFromConversation(conversationData);

        const notePayload = [{
            note_type: 'common',
            params: {
                text: noteContent
            }
        }];

        // Prioriza vincular a nota ao deal, se existir. Senão, ao contato.
        if (dealId) {
            await api.post(`/api/v4/leads/${dealId}/notes`, notePayload);
            logger.info(`[Kommo] Nota adicionada ao deal: ${dealId}`);
        } else {
            await api.post(`/api/v4/contacts/${contactId}/notes`, notePayload);
            logger.info(`[Kommo] Nota adicionada ao contato (deal não encontrado): ${contactId}`);
        }

        return { success: true };
    }

    fetchKommoLeads = async (userSettings) => {
        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({ baseURL: `https://${config.subdomain}.kommo.com`, headers: { 'Authorization': `Bearer ${accessToken}` } });

        let allContacts = [];
        let url = '/api/v4/contacts';

        while (url) {
            const response = await api.get(url);
            const contacts = response.data?._embedded?.contacts || [];
            allContacts = allContacts.concat(contacts);
            url = response.data?._links?.next?.href;
        }

        return allContacts.map(contact => {
            const emailField = contact.custom_fields_values?.find(f => f.field_code === 'EMAIL');
            const phoneField = contact.custom_fields_values?.find(f => f.field_code === 'PHONE');

            return {
                name: contact.name,
                email: emailField?.values[0]?.value,
                phone: phoneField?.values[0]?.value,
                company: 'Não informado', // Kommo não tem um campo padrão de empresa no contato
                position: null,
                source: 'kommo',
                status: 'novo',
                kommo: {
                    id: contact.id,
                    syncStatus: 'synced',
                    lastSync: new Date(),
                }
            };
        }).filter(l => l.email);
    }

    async fetchKommoTasks(userSettings, start, end) {
        const Lead = require('../models/Lead');
        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({
            baseURL: `https://${config.subdomain}.kommo.com`,
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const startTimestamp = Math.floor(new Date(start).getTime() / 1000);
        const endTimestamp = Math.floor(new Date(end).getTime() / 1000);

        const response = await api.get('/api/v4/tasks', {
            params: {
                'filter[is_completed]': 0,
                'filter[complete_till][from]': startTimestamp,
                'filter[complete_till][to]': endTimestamp,
            }
        });

        const tasks = response.data?._embedded?.tasks || [];
        const events = [];

        for (const task of tasks) {
            const endTime = new Date(task.complete_till * 1000);
            const startTime = new Date(endTime.getTime() - 30 * 60 * 1000);

            const contactId = task.entity_id;
            const lead = await Lead.findOne({
                user: userSettings.userId,
                'kommo.id': String(contactId)
            });

            events.push({
                id: `kommo-${task.id}`,
                title: task.text,
                start: startTime.toISOString(),
                end: endTime.toISOString(),
                resource: {
                    leadId: lead?._id,
                    leadName: lead?.name || task.text.replace('Reunião com ', '').split(' (')[0],
                    crm: 'Kommo'
                }
            });
        }
        return events;
    }

    getKommoAvailableSlots = async (userSettings) => {
        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({ baseURL: `https://${config.subdomain}.kommo.com`, headers: { 'Authorization': `Bearer ${accessToken}` } });

        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const response = await api.get('/api/v4/tasks', {
            params: {
                'filter[is_completed]': 0,
                'filter[complete_till][from]': Math.floor(now.getTime() / 1000),
                'filter[complete_till][to]': Math.floor(sevenDaysFromNow.getTime() / 1000),
                'order[complete_till]': 'asc'
            }
        });

        const busySlots = (response.data?._embedded?.tasks || []).map(task => {
            const endTime = new Date(task.complete_till * 1000);
            return {
                start: new Date(endTime.getTime() - 30 * 60 * 1000), // Assume 30 min duration
                end: endTime,
            };
        });

        const availableSlots = [];
        const meetingDuration = 30 * 60 * 1000; // 30 minutes in ms

        for (let i = 1; i <= 7; i++) {
            const day = new Date(now);
            day.setDate(now.getDate() + i);
            const dayOfWeek = day.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekends

            for (let hour = 9; hour < 17; hour++) {
                for (let minute = 0; minute < 60; minute += 30) {
                    if (availableSlots.length >= 3) break;

                    const slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
                    if (slotStart < now) continue;

                    const slotEnd = new Date(slotStart.getTime() + meetingDuration);

                    const isBusy = busySlots.some(busy =>
                        (slotStart < busy.end && slotEnd > busy.start)
                    );

                    if (!isBusy) {
                        availableSlots.push(slotStart);
                    }
                }
            }
        }
        return availableSlots;
    }

    createKommoTask = async (leadData, userSettings, eventDetails) => {
        const contactId = Number(leadData.kommo?.id);
        if (!contactId) throw new Error("ID de contato Kommo inválido ou ausente.");

        const config = integrationUtils._getApiConfig('kommo', userSettings);
        const accessToken = await this._getKommoAccessToken(config, userSettings.userId);
        const api = axios.create({ baseURL: `https://${config.subdomain}.kommo.com`, headers: { 'Authorization': `Bearer ${accessToken}` } });

        const taskPayload = [{
            text: `${eventDetails.text}\n\n${eventDetails.description || ''}`,
            complete_till: eventDetails.complete_till, // timestamp in seconds
            entity_id: contactId,
            entity_type: 'contacts',
        }];

        const response = await api.post('/api/v4/tasks', taskPayload);
        const task = response.data._embedded.tasks[0];
        logger.info(`[Kommo] Task (reunião) criada: ${task.id}`);
        return { id: task.id };
    }
}

module.exports = new KommoService();