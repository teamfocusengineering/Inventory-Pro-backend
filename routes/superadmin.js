const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/authMiddleware');
const superAdminController = require('../controllers/superAdminController');

// All routes require Super Admin authentication
// Note: login route is public for superadmin to login

// @route   POST /api/superadmin/login
// @desc    Super Admin login
router.post('/login', superAdminController.login);

// @route   GET /api/superadmin/me
// @desc    Get current super admin
router.get('/me', auth, superAdminOnly, superAdminController.getMe);

// ==================== ADMIN MANAGEMENT ====================

// @route   POST /api/superadmin/admins
// @desc    Create a new admin
router.post('/admins', auth, superAdminOnly, superAdminController.createAdmin);

// @route   GET /api/superadmin/admins
// @desc    Get all admins
router.get('/admins', auth, superAdminOnly, superAdminController.getAdmins);

// @route   GET /api/superadmin/admins/:id
// @desc    Get single admin
router.get('/admins/:id', auth, superAdminOnly, superAdminController.getAdmin);

// @route   PUT /api/superadmin/admins/:id
// @desc    Update admin
router.put('/admins/:id', auth, superAdminOnly, superAdminController.updateAdmin);

// @route   DELETE /api/superadmin/admins/:id
// @desc    Delete admin
router.delete('/admins/:id', auth, superAdminOnly, superAdminController.deleteAdmin);

// @route   POST /api/superadmin/admins/:id/reset-password
// @desc    Reset admin password
router.post('/admins/:id/reset-password', auth, superAdminOnly, superAdminController.resetAdminPassword);

// ==================== DEALER MANAGEMENT ====================

// @route   POST /api/superadmin/dealers
// @desc    Create a new dealer
router.post('/dealers', auth, superAdminOnly, superAdminController.createDealer);

// @route   GET /api/superadmin/dealers
// @desc    Get all dealers
router.get('/dealers', auth, superAdminOnly, superAdminController.getDealers);

// @route   GET /api/superadmin/dealers/:id
// @desc    Get single dealer
router.get('/dealers/:id', auth, superAdminOnly, superAdminController.getDealer);

// @route   PUT /api/superadmin/dealers/:id
// @desc    Update dealer
router.put('/dealers/:id', auth, superAdminOnly, superAdminController.updateDealer);

// @route   DELETE /api/superadmin/dealers/:id
// @desc    Delete dealer
router.delete('/dealers/:id', auth, superAdminOnly, superAdminController.deleteDealer);

// ==================== SUBSCRIPTION PLANS ====================

// @route   POST /api/superadmin/plans
// @desc    Create a new subscription plan
router.post('/plans', auth, superAdminOnly, superAdminController.createPlan);

// @route   GET /api/superadmin/plans
// @desc    Get all subscription plans
router.get('/plans', auth, superAdminOnly, superAdminController.getPlans);

// @route   GET /api/plans/public
// @desc    Get all subscription plans (public - for website)
router.get('/plans/public', superAdminController.getPlans);

// @route   GET /api/superadmin/plans/:id
// @desc    Get single subscription plan
router.get('/plans/:id', auth, superAdminOnly, superAdminController.getPlan);

// @route   PUT /api/superadmin/plans/:id
// @desc    Update subscription plan
router.put('/plans/:id', auth, superAdminOnly, superAdminController.updatePlan);

// @route   DELETE /api/superadmin/plans/:id
// @desc    Delete subscription plan
router.delete('/plans/:id', auth, superAdminOnly, superAdminController.deletePlan);

// ==================== DASHBOARD ====================

// @route   GET /api/superadmin/dashboard
// @desc    Get dashboard statistics
router.get('/dashboard', auth, superAdminOnly, superAdminController.getDashboardStats);

// ==================== ACTIVITY LOGS ====================

// @route   GET /api/superadmin/logs
// @desc    Get activity logs
router.get('/logs', auth, superAdminOnly, superAdminController.getActivityLogs);

module.exports = router;

