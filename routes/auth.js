const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/roleMiddleware');
const authController = require('../controllers/authController');

// @route   POST /api/auth/register
// @desc    Register a new user (Admin only)
router.post('/register', auth, adminOnly, authController.register);

// @route   POST /api/auth/login
// @desc    Login user (admin or employee)
router.post('/login', authController.login);

// @route   GET /api/auth/me
// @desc    Get current user
router.get('/me', auth, authController.getMe);

// @route   GET /api/auth/users
// @desc    Get all users (Admin only)
router.get('/users', auth, adminOnly, authController.getUsers);

// @route   PUT /api/auth/user/:id
// @desc    Update user status (Admin only)
router.put('/user/:id', auth, adminOnly, authController.updateUser);

module.exports = router;
