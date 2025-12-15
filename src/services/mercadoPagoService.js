

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const MP_ENVIRONMENT = process.env.MERCADO_PAGO_ENVIRONMENT || 'production';

// Credenciais de Produção (para usuários reais)
const ACCESS_TOKEN_PROD = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const WEBHOOK_SECRET_PROD = process.env.MERCADO_PAGO_WEBHOOK_SECRET;

// Credenciais de Teste/Sandbox (para usuários de teste)
const ACCESS_TOKEN_TEST = process.env.MERCADO_PAGO_ACCESS_TOKEN_TEST;
const WEBHOOK_SECRET_TEST = process.env.MERCADO_PAGO_WEBHOOK_SECRET_TEST;

const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com';

class MercadoPagoService {
  constructor() {
    this.environment = MP_ENVIRONMENT;
    this.accessToken = this.environment === 'test' ? ACCESS_TOKEN_TEST : ACCESS_TOKEN_PROD;
    this.webhookSecret = this.environment === 'test' ? WEBHOOK_SECRET_TEST : WEBHOOK_SECRET_PROD;

    if (!this.accessToken) {
      logger.error(`[MercadoPago] O Access Token para o ambiente '${this.environment}' não está configurado.`);
    }
    if (!this.webhookSecret) {
      logger.warn(`[MercadoPago] O Webhook Secret para o ambiente '${this.environment}' não está configurado. A validação de webhooks irá falhar.`);
    }

    this.api = axios.create({
      baseURL: MERCADO_PAGO_API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.api.interceptors.request.use(
      (config) => {
        if (!this.accessToken) {
          const errorMessage = `MERCADO_PAGO_ACCESS_TOKEN para o ambiente '${this.environment}' não está configurado no .env!`;
          logger.error(`[MercadoPago] ${errorMessage}`);
          return Promise.reject(new Error(errorMessage));
        }

        const tokenDisplay = `${this.accessToken.substring(0, 4)}...${this.accessToken.slice(-4)}`;
        logger.info(`[MercadoPago] Usando token de acesso (${this.environment.toUpperCase()}) para a requisição: Bearer ${tokenDisplay}`);
        
        config.headers['Authorization'] = `Bearer ${this.accessToken}`;
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  /**
   * Procura por um cliente no Mercado Pago pelo email.
   * @param {string} email - O email do cliente a ser procurado.
   * @returns {Promise<object|null>} O objeto do cliente se encontrado, caso contrário null.
   */
  async findCustomerByEmail(email) {
    try {
      const response = await this.api.get('/v1/customers/search', {
        params: { email },
      });
      return response.data.results[0] || null;
    } catch (error) {
      logger.error(`[MercadoPago] Erro ao buscar cliente com email ${email}:`, error.response?.data);
      throw error;
    }
  }

  /**
   * Cria um novo cliente no Mercado Pago.
   * @param {object} user - O objeto do usuário do nosso sistema.
   * @returns {Promise<object>} O objeto do cliente criado no Mercado Pago.
   */
  async createCustomer(user) {
    try {
      const payload = {
        email: user.email,
        first_name: user.name.split(' ')[0],
        last_name: user.name.split(' ').slice(1).join(' ') || user.name.split(' ')[0],
      };
      const response = await this.api.post('/v1/customers', payload);
      return response.data;
    } catch (error) {
      logger.error(`[MercadoPago] Erro ao criar cliente para o usuário ${user.id}:`, error.response?.data);
      throw error;
    }
  }
  
  /**
   * Cria uma assinatura no Mercado Pago.
   * @param {object} plan - Detalhes do plano (de `config/plans.js`).
   * @param {object} user - O objeto do usuário do nosso sistema.
   * @returns {Promise<object>} O objeto da assinatura criada.
   */
  async createSubscription(plan, user) {
    try {
      // Procura ou cria um cliente no Mercado Pago para associar à assinatura.
      let customer = await this.findCustomerByEmail(user.email);
      if (!customer) {
        customer = await this.createCustomer(user);
      }
      
      const frontendUrl = 'https://qualifai.tech/';

      const payload = {
        reason: plan.name,
        auto_recurring: {
          frequency: plan.frequency,
          frequency_type: plan.frequency_type,
          transaction_amount: plan.price,
          currency_id: 'BRL', // Moeda: Real Brasileiro
          free_trial: {
            frequency: 7,
            frequency_type: "days"
          }
        },
        back_url: `${frontendUrl}/app/dashboard`, // URL de retorno após o pagamento
        payer_email: user.email,
      };

      const response = await this.api.post('/preapproval', payload);
      return { subscription: response.data, customer };
    } catch (error) {
      logger.error(`[MercadoPago] Erro ao criar assinatura para o plano ${plan.id}:`, error.response?.data);
      throw error;
    }
  }

  /**
   * Busca os detalhes de uma assinatura específica no Mercado Pago.
   * @param {string} subscriptionId - O ID da assinatura (preapproval_id).
   * @returns {Promise<object>} Os dados da assinatura.
   */
  async getSubscription(subscriptionId) {
    try {
      const response = await this.api.get(`/preapproval/${subscriptionId}`);
      return response.data;
    } catch (error) {
      logger.error(`[MercadoPago] Erro ao buscar assinatura ${subscriptionId}:`, error.response?.data);
      throw error;
    }
  }

  /**
   * Cancela uma assinatura no Mercado Pago.
   * @param {string} subscriptionId - O ID da assinatura a ser cancelada.
   * @returns {Promise<object>} O objeto da assinatura atualizado com o status 'cancelled'.
   */
  async cancelSubscription(subscriptionId) {
    try {
      const payload = {
        status: 'cancelled'
      };
      const response = await this.api.put(`/preapproval/${subscriptionId}`, payload);
      return response.data;
    } catch (error) {
      logger.error(`[MercadoPago] Erro ao cancelar assinatura ${subscriptionId}:`, error.response?.data);
      throw error;
    }
  }

  /**
   * Verifica a assinatura de um webhook do Mercado Pago para garantir sua autenticidade.
   * @param {string} signatureHeader - O valor do header 'x-signature'.
   * @param {string} requestId - O valor do header 'x-request-id'.
   * @param {Buffer} payload - O corpo (raw) da requisição.
   * @param {string} notificationId - O ID do recurso notificado (do query param).
   * @returns {boolean} `true` se a assinatura for válida, `false` caso contrário.
   */
  verifyWebhookSignature(signatureHeader, requestId, payload, notificationId) {
    if (!signatureHeader || !this.webhookSecret || !notificationId || !requestId) {
      return false;
    }
    try {
      // O formato do header é: ts=[timestamp],v1=[hash]
      const parts = signatureHeader.split(',').reduce((acc, part) => {
        const [key, value] = part.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});
      
      const timestamp = parts.ts;
      const receivedHash = parts.v1;

      // O manifesto para assinaturas v2 é: id:<notification_id>;request-id:<request_id>;ts:<timestamp>;
      const manifest = `id:${notificationId};request-id:${requestId};ts:${timestamp};`;

      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      hmac.update(manifest);

      const computedHash = hmac.digest('hex');

      return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(receivedHash));
    } catch (error) {
      logger.error('[MercadoPago] Erro ao verificar assinatura do webhook:', error);
      return false;
    }
  }
}

module.exports = new MercadoPagoService();