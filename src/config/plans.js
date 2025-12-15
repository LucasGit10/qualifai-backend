/**
 * @file Contém as definições de todos os planos de assinatura do Stripe.
 * Este arquivo centraliza os detalhes de cada plano, facilitando a manutenção e
 * o gerenciamento de produtos.
 *
 * IMPORTANTE: Os priceId's devem ser criados no seu painel do Stripe e substituídos aqui.
 * Você pode criar seus produtos e preços aqui: https://dashboard.stripe.com/products
 *
 * Estrutura de um plano:
 * - id: Identificador único usado internamente.
 * - priceId: O ID do preço (Price API ID) do Stripe.
 * - name: Nome completo do plano, exibido para o usuário.
 * - associatedPlan: O nível do plano ('basic', 'medium', 'pro') para controle de acesso interno.
 */
module.exports = {
  // Planos BÁSICOS
  'basic-monthly': {
    id: 'basic-monthly',
    priceId: 'price_1Rxso9RxcdNvZ1IGOksAu4xV', // SUBSTITUA PELO SEU PRICE ID
    name: 'QualifAI Starter Mensal',
    associatedPlan: 'basic',
    salesTeamLimit: 1,
  },
  'basic-annual': {
    id: 'basic-annual',
    priceId: 'price_1RwNHWRxcdNvZ1IGdNeGtwa1', // SUBSTITUA PELO SEU PRICE ID
    name: 'QualifAI Starter Anual',
    associatedPlan: 'basic',
    salesTeamLimit: 1,
  },
  
  // Planos MÉDIOS
  'medium-monthly': {
    id: 'medium-monthly',
    priceId: 'price_1RxuxtRxcdNvZ1IGHbZpW3mG', // SUBSTITUA PELO SEU PRICE ID
    name: 'QualifAI Plus Mensal',
    associatedPlan: 'medium',
    salesTeamLimit: 5,
  },
  'medium-annual': {
    id: 'medium-annual',
    priceId: 'price_1RwNMqRxcdNvZ1IGYjSOZVLy', // SUBSTITUA PELO SEU PRICE ID
    name: 'QualifAI Plus Anual',
    associatedPlan: 'medium',
    salesTeamLimit: 5,
  },

  // Planos PRO
  'pro-monthly': {
    id: 'pro-monthly',
    priceId: 'price_1RxuyZRxcdNvZ1IGzw96agQg', // SUBSTITUA PELO SEU PRICE ID
    name: 'QualifAI Premium Mensal',
    associatedPlan: 'pro',
    salesTeamLimit: 15,
  },
  'pro-annual': {
    id: 'pro-annual',
    priceId: 'price_1RwNOgRxcdNvZ1IGP7KO4FGu', // SUBSTITUA PELO SEU PRICE ID
    name: 'QualifAI Premium Anual',
    associatedPlan: 'pro',
    salesTeamLimit: 15,
  },
};