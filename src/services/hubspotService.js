const axios = require('axios');
const logger = require('../utils/logger');
const User = require('../models/User');

class HubSpotService {
    /**
     * Troca um código de autorização por tokens de acesso e de atualização.
     * @param {string} code - O código de autorização recebido do HubSpot.
     * @returns {Promise<object>} - Um objeto contendo accessToken e refreshToken.
     */
    async exchangeCodeForTokens(code) {
        const { HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET } = process.env;
        const backendUrl = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/api$/, '');
        const redirectUri = `${backendUrl}/api/integrations/hubspot/callback`;

        if (!HUBSPOT_CLIENT_ID || !HUBSPOT_CLIENT_SECRET) {
            throw new Error('As credenciais do cliente HubSpot (ID e Secret) não estão configuradas no servidor.');
        }

        const url = 'https://api.hubapi.com/oauth/v1/token';
        const data = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: HUBSPOT_CLIENT_ID,
            client_secret: HUBSPOT_CLIENT_SECRET,
            redirect_uri: redirectUri,
            code: code
        });

        try {
            const response = await axios.post(url, data, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            logger.info('[HubSpot Service] Tokens obtidos com sucesso.');
            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
            };
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message;
            logger.error('[HubSpot Service] Erro ao trocar código por tokens:', {
                message: errorMessage,
                response: error.response?.data
            });
            throw new Error(`Falha ao obter tokens do HubSpot: ${errorMessage}`);
        }
    }
}

module.exports = new HubSpotService();