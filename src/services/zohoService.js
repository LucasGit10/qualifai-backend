const axios = require('axios');
const logger = require('../utils/logger');
const integrationUtils = require('./integrationUtils');
const User = require('../models/User');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class ZohoService {
    // === Zoho CRM Integration ===
    async _getZohoAccessToken(config, userId, retryCount = 0) {
        if (!userId) {
            throw new Error("[Zoho CRM] User ID is required to manage tokens.");
        }
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000 * Math.pow(2, retryCount); // Exponential backoff

        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('client_id', config.clientId);
        params.append('client_secret', config.clientSecret);
        params.append('refresh_token', config.refreshToken);

        const authServer = 'https://accounts.zoho.com';

        try {
            const response = await axios.post(`${authServer}/oauth/v2/token`, params);
            const newAccessToken = response.data.access_token;
            const newRefreshToken = response.data.refresh_token;
            
            if (newRefreshToken && newRefreshToken !== config.refreshToken) {
                logger.info(`[Zoho CRM] Refresh token rotated for user ${userId}. Updating...`);
                await User.findByIdAndUpdate(userId, {
                    'settings.integrations.zoho.refreshToken': newRefreshToken
                });
                config.refreshToken = newRefreshToken; // Update in-memory config for current request
            }

            return newAccessToken;
        } catch (error) {
            const isRateLimitError = error.response?.data?.error_description?.includes('too many requests') || error.response?.data?.error === 'Access Denied';
            
            // Handle invalid_grant error to prevent loops and deactivate integration
            if (error.response?.data?.error === 'invalid_grant') {
                logger.error(`[Zoho CRM] Invalid refresh token for user ${userId}. Deactivating integration. User needs to re-authenticate.`);
                await User.findByIdAndUpdate(userId, {
                    'settings.integrations.zoho.enabled': false,
                });
                // Throw specific error to stop retries
                throw new Error(`Invalid Zoho refresh token for user ${userId}. Integration has been disabled.`);
            }

            if (isRateLimitError && retryCount < MAX_RETRIES) {
                logger.warn(`[Zoho Auth] Rate limit atingido ao obter Access Token. Tentando novamente em ${RETRY_DELAY / 1000}s... (Tentativa ${retryCount + 1}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY);
                return this._getZohoAccessToken(config, userId, retryCount + 1);
            }
            // Re-throw other errors
            throw error;
        }
    }

    createOrUpdateZohoLead = async (leadData, userSettings, retryCount = 0) => {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000 * Math.pow(2, retryCount); // Exponential backoff: 1s, 2s, 4s
        const userId = leadData.user || userSettings.userId;

        try {
            const config = integrationUtils._getApiConfig('zoho', userSettings);
            const accessToken = await this._getZohoAccessToken(config, userId);
            const cleanedApiDomain = integrationUtils.cleanDomain(config.apiDomain);
            const api = axios.create({
                baseURL: `https://${cleanedApiDomain}`,
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });

            const searchResponse = await api.get(`/crm/v2/Leads/search?email=${leadData.email}`);

            // Truncate fields to prevent 400 errors due to length limits
            const leadPayload = {
                First_Name: (integrationUtils.extractFirstName(leadData.name) || '').substring(0, 40),
                Last_Name: (integrationUtils.extractLastName(leadData.name) || leadData.name || 'Não informado').substring(0, 80),
                Company: (leadData.company || 'Não informado').substring(0, 255),
                Email: (leadData.email || '').substring(0, 100),
                Phone: (leadData.phone || '').substring(0, 50),
                Title: (leadData.position || '').substring(0, 100),
                Lead_Source: 'Web'
            };

            let leadId;
            if (searchResponse.data && searchResponse.data.data) {
                leadId = searchResponse.data.data[0].id;
                await api.put('/crm/v2/Leads', { data: [{ id: leadId, ...leadPayload }] });
                logger.info(`[Zoho CRM] Lead atualizado: ${leadId}`);
            } else {
                const createResponse = await api.post('/crm/v2/Leads', { data: [leadPayload] });
                // Check for errors in the create response body itself
                if (createResponse.data.data[0].status === 'error') {
                    const errorDetails = createResponse.data.data[0];
                    throw new Error(`Zoho: ${errorDetails.message} (Código: ${errorDetails.code})`);
                }
                leadId = createResponse.data.data[0].details.id;
                logger.info(`[Zoho CRM] Lead criado: ${leadId}`);
            }
            return { id: leadId };

        } catch (error) {
            // Rate limit check
            const isRateLimitError = error.response?.data?.error_description?.includes('too many requests') || error.response?.data?.code === 'TOO_MANY_REQUESTS';

            if (isRateLimitError && retryCount < MAX_RETRIES) {
                logger.warn(`[Zoho CRM] Rate limit atingido para o lead ${leadData._id}. Tentando novamente em ${RETRY_DELAY / 1000}s... (Tentativa ${retryCount + 1}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY);
                return this.createOrUpdateZohoLead(leadData, userSettings, retryCount + 1);
            }
            
            const zohoError = error.response?.data;
            logger.error('[Zoho CRM] Erro na sincronização:', {
                leadId: leadData._id,
                errorMessage: error.message,
                zohoResponse: zohoError ? JSON.stringify(zohoError) : 'N/A'
            });

            // Construct a more informative error message
            let informativeMessage = 'Erro na API do Zoho.';
            if (zohoError && Array.isArray(zohoError.data) && zohoError.data.length > 0) {
                const firstError = zohoError.data[0];
                const details = firstError.details;
                informativeMessage = `Zoho: ${firstError.message} (Código: ${firstError.code}${details?.api_name ? `, Campo: ${details.api_name}` : ''})`;
            } else if (error.message.startsWith('Zoho:')) {
                // Propagate error from successful request but failed creation
                informativeMessage = error.message;
            } else if (zohoError) {
                // Fallback for other error structures
                informativeMessage = `Zoho: ${zohoError.message || zohoError.error_description || JSON.stringify(zohoError)}`;
            }

            throw new Error(informativeMessage);
        }
    }

    convertZohoLead = async (leadData, userSettings, retryCount = 0) => {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000 * Math.pow(2, retryCount);
        const userId = leadData.user || userSettings.userId;
    
        try {
            const config = integrationUtils._getApiConfig('zoho', userSettings);
            const accessToken = await this._getZohoAccessToken(config, userId);
            const api = axios.create({ baseURL: `https://${config.apiDomain}`, headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } });
    
            const convertPayload = {
                "Deals": [{
                    "Deal_Name": `Oportunidade - ${leadData.company}`,
                    "Stage": "Qualification",
                    "Closing_Date": new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split('T')[0]
                }]
            };
    
            const response = await api.post(`/crm/v2/Leads/${leadData.zoho.id}/actions/convert`, { data: [convertPayload] });
            const dealId = response.data.data[0].Deals;
            logger.info(`[Zoho CRM] Lead convertido e Deal criado: ${dealId}`);
            return { dealId: dealId };
        } catch(error) {
            const isRateLimitError = error.response?.data?.error_description?.includes('too many requests') || error.response?.data?.code === 'TOO_MANY_REQUESTS';
            if (isRateLimitError && retryCount < MAX_RETRIES) {
                logger.warn(`[Zoho CRM] Rate limit atingido ao converter lead ${leadData._id}. Tentando novamente em ${RETRY_DELAY / 1000}s... (Tentativa ${retryCount + 1}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY);
                return this.convertZohoLead(leadData, userSettings, retryCount + 1);
            }
            logger.error('[Zoho CRM] Erro ao converter lead:', {
                message: error.message,
                zohoResponse: error.response?.data,
            });
            throw error;
        }
    }

    async createZohoEvent(lead, eventDetails, userSettings) {
        const userId = lead.user || userSettings.userId;
        const config = integrationUtils._getApiConfig('zoho', userSettings);
        const accessToken = await this._getZohoAccessToken(config, userId);
        const api = axios.create({
            baseURL: `https://${integrationUtils.cleanDomain(config.apiDomain)}`,
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        if (!lead.zoho?.id) {
            logger.warn(`[Zoho CRM] Cannot create event for lead ${lead._id} without a Zoho lead ID.`);
            return;
        }
    
        const eventData = {
            Event_Title: eventDetails.title,
            Start_DateTime: eventDetails.startTime.toISOString(),
            End_DateTime: eventDetails.endTime.toISOString(),
            Description: eventDetails.description,
            Who_Id: {
                id: lead.zoho.id
            }
        };
    
        const response = await api.post('/crm/v2/Events', { data: [eventData] });
    
        if (response.data.data[0].status === 'error') {
            const errorDetails = response.data.data[0];
            throw new Error(`Zoho: ${errorDetails.message} (Code: ${errorDetails.code})`);
        }
    
        const eventId = response.data.data[0].details.id;
        logger.info(`[Zoho CRM] Event created: ${eventId}`);
        return response.data.data[0];
    }

    fetchZohoLeads = async (userSettings, retryCount = 0) => {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000 * Math.pow(2, retryCount);

        try {
            const config = integrationUtils._getApiConfig('zoho', userSettings);
            const accessToken = await this._getZohoAccessToken(config, userSettings.userId);
            const api = axios.create({ baseURL: `https://${integrationUtils.cleanDomain(config.apiDomain)}`, headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } });

            const allLeads = [];
            let page = 1;
            let hasMoreRecords = true;
            const pageDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

            while (hasMoreRecords) {
                try {
                    const response = await api.get('/crm/v2/Leads', {
                        params: {
                            sort_by: 'Created_Time',
                            sort_order: 'desc',
                            page: page,
                            per_page: 200 // Máximo por página no Zoho
                        }
                    });

                    const leadsOnPage = response.data.data;
                    if (leadsOnPage && leadsOnPage.length > 0) {
                        allLeads.push(...leadsOnPage);
                    }

                    if (response.data.info?.more_records) {
                        page++;
                        await pageDelay(300); // Pausa para evitar rate limit
                    } else {
                        hasMoreRecords = false;
                    }
                } catch (pageError) {
                    const isPageRateLimitError = pageError.response?.data?.error_description?.includes('too many requests') || pageError.response?.data?.code === 'TOO_MANY_REQUESTS';
                    if (isPageRateLimitError) {
                        throw pageError; 
                    }
                    logger.error('[Zoho CRM] Erro ao buscar página de leads:', { page, error: pageError.response?.data || pageError.message });
                    hasMoreRecords = false;
                }
            }
    
            return allLeads.map(lead => ({
                name: `${lead.First_Name || ''} ${lead.Last_Name || ''}`.trim(),
                email: lead.Email,
                phone: lead.Phone,
                company: lead.Company,
                position: lead.Title,
                source: 'zoho',
                status: 'novo',
                zoho: {
                    id: lead.id,
                    syncStatus: 'synced',
                    lastSync: new Date(),
                }
            })).filter(l => l.email);

        } catch (error) {
            const isRateLimitError = error.response?.data?.error_description?.includes('too many requests') || error.response?.data?.code === 'TOO_MANY_REQUESTS';

            if (isRateLimitError && retryCount < MAX_RETRIES) {
                logger.warn(`[Zoho CRM] Rate limit atingido ao buscar leads. Tentando novamente em ${RETRY_DELAY / 1000}s... (Tentativa ${retryCount + 1}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY);
                return this.fetchZohoLeads(userSettings, retryCount + 1);
            }

            logger.error('[Zoho CRM] Erro geral ao buscar leads:', error.response?.data || error.message);
            throw error;
        }
    }

    async fetchZohoEvents(userSettings, start, end, retryCount = 0) {
        const Lead = require('../models/Lead');
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000 * Math.pow(2, retryCount);

        try {
            const config = integrationUtils._getApiConfig('zoho', userSettings);
            const accessToken = await this._getZohoAccessToken(config, userSettings.userId);
            const api = axios.create({
                baseURL: `https://${integrationUtils.cleanDomain(config.apiDomain)}`,
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });

            const formatDateTimeForZoho = (isoDateString) => {
                // Converts a standard ISO string (e.g., '2025-07-01T03:00:00.000Z')
                // to Zoho's required COQL datetime format (e.g., '2025-07-01T03:00:00+00:00')
                // by removing milliseconds and replacing 'Z' with a UTC offset.
                return new Date(isoDateString).toISOString().replace(/\.\d{3}Z$/, '+00:00');
            };
    
            const formattedStart = formatDateTimeForZoho(start);
            const formattedEnd = formatDateTimeForZoho(end);

            const coqlQuery = {
                "select_query": `select Event_Title, Start_DateTime, End_DateTime, Who_Id from Events where Start_DateTime >= '${formattedStart}' and End_DateTime <= '${formattedEnd}'`
            };
    
            const response = await api.post('/crm/v2/coql', coqlQuery);
            const zohoEvents = response.data?.data || [];
            const events = [];
    
            for (const event of zohoEvents) {
                const whoId = event.Who_Id;
                if (!whoId || !whoId.id) continue;
    
                const lead = await Lead.findOne({
                    user: userSettings.userId,
                    'zoho.id': whoId.id
                });
    
                events.push({
                    id: `zoho-${event.id}`,
                    title: event.Event_Title,
                    start: new Date(event.Start_DateTime).toISOString(),
                    end: new Date(event.End_DateTime).toISOString(),
                    resource: {
                        leadId: lead?._id,
                        leadName: lead?.name || whoId.name || 'Lead não associado',
                        crm: 'Zoho'
                    }
                });
            }
            return events;
        } catch(error) {
            const zohoError = error.response?.data;
            if (zohoError && zohoError.code === 'OAUTH_SCOPE_MISMATCH') {
                const detailedError = new Error('Permissões insuficientes no Zoho CRM para buscar eventos. Por favor, re-autorize a aplicação garantindo que os escopos "ZohoCRM.coql.READ" e "ZohoCRM.modules.events.READ" estão habilitados.');
                logger.error('[Zoho CRM] Escopo OAuth ausente para buscar eventos.', { userId: userSettings.userId });
                throw detailedError;
            }

            const isRateLimitError = error.response?.data?.error_description?.includes('too many requests') || error.response?.data?.code === 'TOO_MANY_REQUESTS';
            if (isRateLimitError && retryCount < MAX_RETRIES) {
                logger.warn(`[Zoho CRM] Rate limit atingido ao buscar eventos. Tentando novamente em ${RETRY_DELAY / 1000}s... (Tentativa ${retryCount + 1}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY);
                return this.fetchZohoEvents(userSettings, start, end, retryCount + 1);
            }
    
            logger.error('[Zoho CRM] Erro ao buscar eventos:', {
                message: error.message,
                zohoResponse: error.response?.data,
            });
            throw error;
        }
    }

}

module.exports = new ZohoService();