const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// Middleware para validar requisições
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * @route   POST /api/payments/create-checkout-session
 * @desc    Creates a Stripe checkout session for a subscription.
 * @access  Private
 * @body    { "planId": "pro-monthly" }
 */
router.post(
  '/create-checkout-session',
  auth,
  [
    body('planId', 'The plan ID is required').notEmpty(),
  ],
  validate,
  paymentController.createCheckoutSession
);

/**
 * @route   POST /api/payments/create-portal-session
 * @desc    Creates a Stripe Customer Portal session for the user to manage their subscription.
 * @access  Private
 */
router.post(
  '/create-portal-session',
  auth,
  paymentController.createPortalSession
);

// The Stripe webhook route is defined in server.js to properly handle raw body parsing.

module.exports = router;