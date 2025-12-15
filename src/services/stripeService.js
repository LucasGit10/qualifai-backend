

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const plans = require('../config/plans');
const logger = require('../utils/logger');

// Helper function to find plan details from a Stripe priceId
const getPlanFromPriceId = (priceId) => {
  for (const planKey in plans) {
    if (plans[planKey].priceId === priceId) {
      // Return the key and the plan object
      return { planId: planKey, ...plans[planKey] };
    }
  }
  return null;
};

class StripeService {
  /**
   * Finds an existing Stripe customer or creates a new one.
   * @param {object} user - The user object from our database.
   * @returns {Promise<object>} The Stripe customer object.
   */
  async findOrCreateCustomer(user) {
    if (user.stripe && user.stripe.customerId) {
      try {
        const customer = await stripe.customers.retrieve(user.stripe.customerId);
        if (customer && !customer.deleted) {
          return customer;
        }
      } catch (error) {
        logger.warn(`Stripe customer ${user.stripe.customerId} not found for user ${user._id}. Creating a new one.`);
      }
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        userId: user._id.toString(),
      },
    });

    await User.findByIdAndUpdate(user._id, { 'stripe.customerId': customer.id });
    return customer;
  }

  /**
   * Creates a Stripe Checkout session for a subscription.
   * @param {object} user - The user object.
   * @param {string} planId - The internal plan identifier.
   * @returns {Promise<object>} The Stripe Checkout session object.
   */
  async createCheckoutSession(user, planId) {
    const customer = await this.findOrCreateCustomer(user);
    const plan = plans[planId];
    if (!plan || !plan.priceId) {
      throw new Error(`Plan or Price ID not found for planId: ${planId}`);
    }

    const sessionOptions = {
      payment_method_types: ['card'],
      customer: customer.id,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${'https://www.qualifai.tech'}/app/dashboard?stripe_success=true`,
      cancel_url: `${'https://www.qualifai.tech'}/signature`,
      metadata: {
        userId: user._id.toString(),
        planId: planId,
      }
    };

    const hasActiveSubscription = user.stripe?.subscriptionStatus && ['active', 'trialing'].includes(user.stripe.subscriptionStatus);
    
    if (!hasActiveSubscription) {
      sessionOptions.subscription_data = {
        trial_period_days: 7,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionOptions);

    return session;
  }

  /**
   * Creates a Stripe Customer Portal session.
   * @param {object} user - The user object.
   * @returns {Promise<object>} The Stripe Portal session object.
   */
  async createPortalSession(user) {
    if (!user.stripe || !user.stripe.customerId) {
      throw new Error('User does not have a Stripe customer ID.');
    }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe.customerId,
      return_url: `${'https://www.qualifai.tech'}/app/profile-user`,
    });
    return portalSession;
  }

  /**
   * Handles incoming webhooks from Stripe.
   * @param {Buffer} payload - The raw request body.
   * @param {string} signature - The 'stripe-signature' header.
   */
  async handleWebhook(payload, signature) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    if (!webhookSecret) {
        logger.error('STRIPE_WEBHOOK_SECRET is not set.');
        throw new Error('Webhook secret not configured.');
    }

    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      logger.error(`⚠️  Stripe webhook signature verification failed: ${err.message}`);
      throw new Error('Webhook signature verification failed. Please ensure you are sending the raw request body from Stripe.');
    }

    const dataObject = event.data.object;
    logger.info(`[Stripe] Processing webhook event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = dataObject;
        const { userId, planId } = session.metadata;
        
        if (!planId || !plans[planId]) {
          logger.error(`[Stripe] Webhook checkout.session.completed missing or invalid planId in metadata for session ${session.id}`);
          break;
        }
        
        const subscription = await stripe.subscriptions.retrieve(session.subscription);

        await User.findByIdAndUpdate(userId, {
            'stripe.subscriptionId': subscription.id,
            'stripe.customerId': session.customer,
            'stripe.subscriptionStatus': subscription.status,
            'stripe.planId': planId,
            'stripe.priceId': subscription.items.data[0]?.price.id,
            'stripe.currentPeriodEnd': subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
            'plan': plans[planId].associatedPlan,
        });

        logger.info(`[Stripe] User ${userId} successfully subscribed to plan ${planId}.`);
        break;
      }
      
      case 'customer.subscription.updated': {
        const subscription = dataObject;
        const user = await User.findOne({ 'stripe.customerId': subscription.customer });

        if (user) {
            const priceId = subscription.items.data[0]?.price.id;
            const planDetails = getPlanFromPriceId(priceId);

            let userPlan = user.plan;
            let userPlanId = user.stripe.planId;

            if (planDetails && ['active', 'trialing'].includes(subscription.status)) {
                userPlan = planDetails.associatedPlan;
                userPlanId = planDetails.planId;
            } else if (['canceled', 'unpaid', 'incomplete_expired', 'past_due'].includes(subscription.status)) {
                userPlan = 'guest';
            }

            await User.updateOne({ _id: user._id }, {
                'stripe.subscriptionId': subscription.id,
                'stripe.subscriptionStatus': subscription.status,
                'stripe.planId': userPlanId,
                'stripe.priceId': priceId,
                'stripe.currentPeriodEnd': subscription.current_period_end
                  ? new Date(subscription.current_period_end * 1000)
                  : null,
                'plan': userPlan,
            });
            logger.info(`[Stripe] Subscription for user ${user._id} updated. Status: ${subscription.status}, Plan: ${userPlan}.`);
        } else {
            logger.warn(`[Stripe] User not found for customer ID during subscription update: ${subscription.customer}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = dataObject;
        const user = await User.findOne({ 'stripe.subscriptionId': subscription.id });
        if (user) {
            await User.updateOne({ _id: user._id }, {
                'stripe.subscriptionStatus': 'canceled',
                'stripe.currentPeriodEnd': null,
                'plan': 'guest',
            });
            logger.info(`[Stripe] Subscription ${subscription.id} for user ${user._id} deleted. Plan set to guest.`);
        } else {
            logger.warn(`[Stripe] User not found for subscription deletion: ${subscription.id}`);
        }
        break;
      }

      default:
        logger.info(`[Stripe] Unhandled webhook event type: ${event.type}`);
    }
    
    return { received: true };
  }
}

module.exports = new StripeService();