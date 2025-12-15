const axios = require('axios');
const logger = require('../utils/logger');
const integrationUtils = require('./integrationUtils');
const User = require('../models/User');

class PipedriveService {
  async exchangeCodeForTokens(code) {
    const { PIPEDRIVE_CLIENT_ID, PIPEDRIVE_CLIENT_SECRET } = process.env;
    const redirectUri = `${process.env.BACKEND_URL}/api/integrations/pipedrive/callback`;
    const authHeader = `Basic ${Buffer.from(`${PIPEDRIVE_CLIENT_ID}:${PIPEDRIVE_CLIENT_SECRET}`).toString('base64')}`;

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    try {
        const response = await axios.post('https://oauth.pipedrive.com/oauth/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': authHeader,
            }
        });
        return {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            apiDomain: response.data.api_domain,
        };
    } catch (error) {
        logger.error('[Pipedrive] Erro ao trocar código por token:', error.response?.data || error.message);
        throw new Error('Falha ao obter tokens do Pipedrive.');
    }
  }

  async _getPipedriveAccessToken(userSettings) {
    const config = integrationUtils._getApiConfig('pipedrive', userSettings);
    const { PIPEDRIVE_CLIENT_ID, PIPEDRIVE_CLIENT_SECRET } = process.env;
    if (!PIPEDRIVE_CLIENT_ID || !PIPEDRIVE_CLIENT_SECRET) {
      throw new Error('Credenciais do Pipedrive não configuradas no servidor.');
    }
    const authHeader = `Basic ${Buffer.from(`${PIPEDRIVE_CLIENT_ID}:${PIPEDRIVE_CLIENT_SECRET}`).toString('base64')}`;

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', config.refreshToken);

    try {
        const response = await axios.post('https://oauth.pipedrive.com/oauth/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': authHeader,
            }
        });
        return response.data.access_token;
    } catch (error) {
        logger.error(`[Pipedrive] Erro ao renovar access token para usuário ${userSettings.userId}:`, error.response?.data);
        if (error.response?.data?.error === 'invalid_grant') {
            await User.findByIdAndUpdate(userSettings.userId, {
                'settings.integrations.pipedrive.enabled': false,
            });
        }
        throw new Error('Falha ao renovar token do Pipedrive. Tente reconectar a integração.');
    }
  }

  async _getAuthedApi(userSettings) {
    const config = integrationUtils._getApiConfig('pipedrive', userSettings);
    if (!config.apiDomain) {
        throw new Error('Domínio da API Pipedrive não configurado para o usuário.');
    }
    const accessToken = await this._getPipedriveAccessToken(userSettings);
    return axios.create({
        baseURL: `${config.apiDomain}/api/v1`,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        }
    });
  }

  updatePipedrivePerson = async (personId, leadData, userSettings) => {
    const api = await this._getAuthedApi(userSettings);
    const personData = {
      name: leadData.name,
      email: [{ value: leadData.email, primary: true }],
      phone: [{ value: leadData.phone || '', primary: true }],
    };
    logger.info(`[Pipedrive] Atualizando pessoa ${personId}`);
    return api.put(`/persons/${personId}`, personData);
  }

  async createOrUpdatePipedrivePerson(leadData, userSettings) {
    const api = await this._getAuthedApi(userSettings);
    const response = await api.get('/persons/search', { params: { term: leadData.email, fields: 'email', exact_match: true } });
    const personData = {
      name: leadData.name,
      email: [{ value: leadData.email, primary: true }],
      phone: [{ value: leadData.phone || '', primary: true }],
    };
    if (response.data.success && response.data.data.items.length > 0) {
      const personId = response.data.data.items[0].item.id;
      return api.put(`/persons/${personId}`, personData);
    }
    return api.post('/persons', personData);
  }

  async createPipedriveActivity(lead, eventDetails, userSettings) {
    const api = await this._getAuthedApi(userSettings);

    if (!lead.pipedrive?.personId) {
        logger.warn(`[Pipedrive] Cannot create activity for lead ${lead._id} without a personId.`);
        return;
    }

    const activityData = {
        subject: eventDetails.title,
        note: eventDetails.description,
        person_id: lead.pipedrive.personId,
        due_date: eventDetails.startTime.toISOString().split('T')[0],
        due_time: eventDetails.startTime.toTimeString().split(' ')[0],
    };

    const response = await api.post('/activities', activityData);
    logger.info(`[Pipedrive] Activity created: ${response.data.data.id}`);
    return response.data.data;
  }

  fetchPipedriveLeads = async (userSettings) => {
    const api = await this._getAuthedApi(userSettings);
    const allPersons = [];
    let start = 0;
    let moreItems = true;
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    while (moreItems) {
      const response = await api.get('/persons', {
        params: {
          sort: 'add_time DESC',
          limit: 500,
          start: start
        }
      });
      
      if (!response.data.success || !response.data.data) {
        moreItems = false;
        continue;
      }
      
      allPersons.push(...response.data.data);
      
      const pagination = response.data.additional_data?.pagination;
      if (pagination && pagination.more_items_in_collection) {
        start = pagination.next_start;
        await delay(250);
      } else {
        moreItems = false;
      }
    }

    return allPersons.map(person => ({
        name: person.name,
        email: person.email?.[0]?.value,
        phone: person.phone?.[0]?.value,
        company: person.org_name || 'Não informado',
        position: null,
        source: 'pipedrive',
        status: 'novo',
        pipedrive: {
            personId: String(person.id),
            syncStatus: 'synced',
            lastSync: new Date()
        }
    })).filter(lead => lead.email);
  }

  async fetchPipedriveActivities(userSettings, start, end) {
    const Lead = require('../models/Lead');
    const api = await this._getAuthedApi(userSettings);

    const startDate = new Date(start).toISOString().split('T')[0];
    const endDate = new Date(end).toISOString().split('T')[0];

    const response = await api.get('/activities', {
        params: {
            start_date: startDate,
            end_date: endDate,
            done: 0,
        }
    });

    const activities = response.data?.data || [];
    const events = [];

    for (const activity of activities) {
        if (!activity.person_id) continue;

        const dueDateTime = new Date(`${activity.due_date}T${activity.due_time || '00:00:00'}`);
        
        let durationMinutes = 30;
        if (activity.duration) {
            const [hours, minutes] = activity.duration.split(':').map(Number);
            durationMinutes = (hours * 60) + minutes;
        }

        const endTime = new Date(dueDateTime.getTime() + durationMinutes * 60 * 1000);

        const lead = await Lead.findOne({
            user: userSettings.userId,
            'pipedrive.personId': String(activity.person_id)
        });

        events.push({
            id: `pipedrive-${activity.id}`,
            title: activity.subject,
            start: dueDateTime.toISOString(),
            end: endTime.toISOString(),
            resource: {
                leadId: lead?._id,
                leadName: activity.person_name,
                crm: 'Pipedrive'
            }
        });
    }

    return events;
  }
}

module.exports = new PipedriveService();