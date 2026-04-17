const express = require('express');
const router = express.Router();
const notificationController = require('../../controllers/platform/notification.controller');
const auth = require('../../middleware/auth');

router.get('/', auth, notificationController.getNotifications);
router.patch('/:id/read', auth, notificationController.markAsRead);
router.patch('/read-all', auth, notificationController.markAllAsRead);
router.delete('/clear-all', auth, notificationController.deleteAll); // Adicionado
router.post('/welcome-push', auth, notificationController.sendWelcomePush);
router.post('/subscription', auth, notificationController.updateSubscription); // Adicionado
router.post('/test', auth, notificationController.sendTestNotification); // Adicionado

module.exports = router;
