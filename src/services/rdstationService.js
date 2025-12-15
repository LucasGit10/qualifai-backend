const axios = require('axios');
const logger = require('../utils/logger');
const integrationUtils = require('./integrationUtils');
const User = require('../models/User');

class RDStationService {
  // === RD Station Integration ===
  createOrUpdateRDStationContact = async (leadData, userSettings) => {
    const config = integrationUtils._getApiConfig('rdstation', userSettings);
    if (!config.privateToken) {
        throw new Error('RD Station privateToken não configurado.');
    }

    const api = axios.create({
        baseURL: 'https://api.rd.services',
    });

    const contactPayload = {
        email: leadData.email,
        name: leadData.name,
        legal_bases: [
            {
                category: "communications",
                type: "consent",
                status: "granted"
            }
        ]
    };

    if (leadData.position) {
        contactPayload.job_title = leadData.position;
    }
    if (leadData.company) {
        contactPayload.company_name = leadData.company;
    }
    if (leadData.phone) {
        contactPayload.personal_phone = leadData.phone;
    }

    const response = await api.post(`/platform/contacts?token=${config.privateToken}`, contactPayload);
    
    logger.info(`[RD Station] Contato sincronizado: ${response.data.uuid}`);
    return { id: response.data.uuid };
}

createRDStationConversionEvent = async (leadData, userSettings) => {
    const config = this._getApiConfig('rdstation', userSettings);
    if (!config.privateToken) {
        throw new Error('RD Station privateToken não configurado.');
    }

    const api = axios.create({ baseURL: 'https://api.rd.services' });

    const conversionPayload = {
        token_rdstation: config.privateToken,
        identificador: 'lead_qualificado_qualifai',
        email: leadData.email,
        name: leadData.name,
        company: leadData.company,
        job_title: leadData.position,
    };

    await api.post('/api/1.2/conversions', conversionPayload);
    logger.info(`[RD Station] Evento de conversão (legado) criado para: ${leadData.email}`);
    return { success: true };
}

fetchRdstationLeads = async (userSettings) => {
    const config = integrationUtils._getApiConfig('rdstation', userSettings);
    if (!config.privateToken) {
        throw new Error('RD Station privateToken não configurado.');
    }
    const api = axios.create({ baseURL: 'https://api.rd.services' });
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    let allContacts = [];
    let page = 1;
    let hasMore = true;

    try {
        while (hasMore) {
            const response = await api.get(`/platform/contacts`, {
                params: {
                    token: config.privateToken,
                    sort_by: 'created_at',
                    sort_direction: 'desc',
                    page: page,
                    per_page: 200 // Limite máximo da API RD Station
                }
            });
            
            if (response.data.contacts && response.data.contacts.length > 0) {
                allContacts.push(...response.data.contacts);
                page++;
                await delay(250); // Pausa para evitar rate limit
            } else {
                hasMore = false;
            }
        }
    } catch (error) {
        logger.error('[RD Station] Erro ao buscar contatos com paginação:', error.response?.data || error.message);
        throw error;
    }
    
    return allContacts.map(contact => ({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company_name,
        position: contact.job_title,
        source: 'rdstation',
        status: 'novo',
        rdstation: {
            id: contact.uuid,
            syncStatus: 'synced',
            lastSync: new Date(),
        }
    })).filter(l => l.email);
}

}

module.exports = new RDStationService();
