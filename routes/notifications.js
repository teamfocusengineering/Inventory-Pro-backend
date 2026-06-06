const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { auth } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

// All routes require authentication
router.use(auth);

// Get notifications for current user
router.get('/', notificationController.getNotifications);

// Get unread count
router.get('/unread-count', notificationController.getUnreadCount);

// Mark notification as read
router.put('/:id/read', notificationController.markAsRead);

// Mark all as read
router.put('/read-all', notificationController.markAllAsRead);

// Delete notification
router.delete('/:id', notificationController.deleteNotification);

// Get all admins (for superadmin)
router.get('/admins', authorize('superadmin'), notificationController.getAllAdmins);

// Get employees under admin
router.get('/users', authorize('admin', 'superadmin'), notificationController.getAdminUsers);

// Send message from SuperAdmin to Admin
router.post('/to-admin', authorize('superadmin'), notificationController.sendMessageToAdmin);

// Broadcast to employees
router.post('/broadcast-employees', authorize('admin'), notificationController.broadcastToEmployees);

module.exports = router;

