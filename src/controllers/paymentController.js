const User = require('../models/User');
const logger = require('../utils/logger');
const stripeService = require('../services/stripeService');
const plans = require('../config/plans');

class PaymentController {
  async createCheckoutSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        logger.warn('createCheckoutSession chamada sem um usuário válido no objeto req.');
        return res.status(401).json({ message: 'Erro ao criar sessão de checkout. Por favor, certifique-se de que está logado.' });
      }

      const { planId } = req.body;
      const userId = req.user.id;

      if (!planId || !plans[planId]) {
        return res.status(400).json({ message: 'planId inválido ou ausente.' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      const session = await stripeService.createCheckoutSession(user, planId);

      res.json({ url: session.url });
    } catch (error) {
      logger.error('Erro ao criar sessão de checkout do Stripe:', {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });
      res.status(500).json({ message: 'Ocorreu um erro interno ao criar a sessão de checkout.' });
    }
  }

  async createPortalSession(req, res) {
    try {
        if (!req.user || !req.user.id) {
            logger.warn('createPortalSession chamada sem um usuário válido no objeto req.');
            return res.status(401).json({ message: 'Erro ao criar sessão do portal. Por favor, certifique-se de que está logado.' });
        }
        const userId = req.user.id;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        
        const portalSession = await stripeService.createPortalSession(user);
        res.json({ url: portalSession.url });
    } catch (error) {
        logger.error('Erro ao criar sessão do portal do Stripe:', {
            message: error.message,
            stack: error.stack,
            userId: req.user?.id,
        });

        // Tratamento de erro específico para configuração do portal
        if (error.message && error.message.includes('No configuration provided')) {
            return res.status(500).json({ message: 'O Portal do Cliente Stripe não está configurado. Por favor, configure-o no seu Painel Stripe em Configurações > Faturamento > Portal do cliente.' });
        }
        
        res.status(500).json({ message: 'Ocorreu um erro interno ao criar a sessão do portal.' });
    }
  }

  async handleWebhook(req, res) {
    const signature = req.headers['stripe-signature'];
    try {
      const result = await stripeService.handleWebhook(req.body, signature);
      res.status(200).json(result);
    } catch (error) {
      logger.error('Erro no manipulador de webhook do Stripe:', {
        message: error.message,
        stack: error.stack
      });
      res.status(400).json({ message: error.message });
    }
  }
}

module.exports = new PaymentController();