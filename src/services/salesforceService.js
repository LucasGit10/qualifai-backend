const axios = require('axios');
const logger = require('../utils/logger');
const integrationUtils = require('./integrationUtils');
const User = require('../models/User');

class SalesforceService {
  // === Salesforce Integration ===
  async _getSalesforceAccessToken(config) {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', config.clientId);
    params.append('client_secret', config.clientSecret);
    params.append('refresh_token', config.refreshToken);

    const response = await axios.post(`${config.instanceUrl}/services/oauth2/token`, params);
    return response.data.access_token;
}

createOrUpdateSalesforceLead = async (leadData, userSettings) => {
    const config = integrationUtils._getApiConfig('salesforce', userSettings);
    const accessToken = await this._getSalesforceAccessToken(config);
    const api = axios.create({
        baseURL: config.instanceUrl,
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const soqlQuery = `SELECT Id FROM Lead WHERE Email = '${leadData.email}' LIMIT 1`;
    const searchResponse = await api.get(`/services/data/v58.0/query/?q=${encodeURIComponent(soqlQuery)}`);

    const leadPayload = {
        FirstName: integrationUtils.extractFirstName(leadData.name),
        LastName: integrationUtils.extractLastName(leadData.name) || leadData.name,
        Company: leadData.company,
        Email: leadData.email,
        Phone: leadData.phone,
        Title: leadData.position,
        LeadSource: 'Web'
    };

    if (searchResponse.data.records.length > 0) {
        const leadId = searchResponse.data.records[0].Id;
        await api.patch(`/services/data/v58.0/sobjects/Lead/${leadId}`, leadPayload);
        logger.info(`[Salesforce] Lead atualizado: ${leadId}`);
        return { id: leadId };
    } else {
        const createResponse = await api.post('/services/data/v58.0/sobjects/Lead', leadPayload);
        logger.info(`[Salesforce] Lead criado: ${createResponse.data.id}`);
        return { id: createResponse.data.id };
    }
}

createSalesforceOpportunity = async (leadData, userSettings) => {
    const config = integrationUtils._getApiConfig('salesforce', userSettings);
    const accessToken = await this._getSalesforceAccessToken(config);
    const api = axios.create({ baseURL: config.instanceUrl, headers: { 'Authorization': `Bearer ${accessToken}` }});

    // Para criar uma Opportunity, precisamos converter o Lead.
    const convertPayload = {
        leadId: leadData.salesforce.id,
        convertedStatus: 'Qualified' // O nome do status deve existir na sua org Salesforce
    };

    try {
        const response = await api.post(`/services/data/v58.0/lead/convert`, { leadConverts: [convertPayload] });
        if (response.data.success) {
            logger.info(`[Salesforce] Lead convertido para Oportunidade: ${response.data.opportunityId}`);
            return { id: response.data.opportunityId };
        }
    } catch (error) {
        logger.error('[Salesforce] Erro ao converter lead:', error.response?.data);
        throw error;
    }
}

fetchSalesforceLeads = async (userSettings) => {
    const config = integrationUtils._getApiConfig('salesforce', userSettings);
    const accessToken = await this._getSalesforceAccessToken(config);
    const api = axios.create({
        baseURL: config.instanceUrl,
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    let allRecords = [];
    let nextRecordsUrl = `/services/data/v58.0/query/?q=${encodeURIComponent('SELECT Name, Email, Phone, Company, Title, Id FROM Lead ORDER BY CreatedDate DESC')}`;

    try {
        while (nextRecordsUrl) {
            const response = await api.get(nextRecordsUrl);
            allRecords.push(...response.data.records);
            // O nextRecordsUrl da API do Salesforce já é o URL completo, então não precisamos concatenar com a baseURL.
            nextRecordsUrl = response.data.done ? null : response.data.nextRecordsUrl;
        }
    } catch (error) {
        logger.error('[Salesforce] Erro ao buscar leads com paginação:', error.response?.data || error.message);
        throw error;
    }

    return allRecords.map(lead => ({
        name: lead.Name,
        email: lead.Email,
        phone: lead.Phone,
        company: lead.Company,
        position: lead.Title,
        source: 'salesforce',
        status: 'novo',
        salesforce: {
            id: lead.Id,
            syncStatus: 'synced',
            lastSync: new Date(),
        }
    })).filter(l => l.email);
}


}

module.exports = new SalesforceService();
