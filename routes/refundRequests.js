const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/roleMiddleware');
const refundController = require('../controllers/refundController');

// @route   POST /api/refund-requests
// @desc    Create a refund request with reason
// @access  Customer/Employee/Admin
router.post('/', auth, refundController.createRefundRequest);

// @route   GET /api/refund-requests
// @desc    Get all refund requests (admin) or user's own requests
// @access  All authenticated users
router.get('/', auth, refundController.getRefundRequests);

// @route   GET /api/refund-requests/my
// @desc    Get current user's refund requests
// @access  Customer/Employee/Admin
router.get('/my', auth, refundController.getMyRefundRequests);

// @route   PUT /api/refund-requests/:id/approve
// @desc    Approve refund request and restore stock
// @access  Admin only
router.put('/:id/approve', auth, adminOnly, refundController.approveRefundRequest);

// @route   PUT /api/refund-requests/:id/reject
// @desc    Reject refund request
// @access  Admin only
router.put('/:id/reject', auth, adminOnly, refundController.rejectRefundRequest);

// @route   GET /api/refund-requests/pending
// @desc    Get count of pending refund requests
// @access  Admin only
router.get('/pending/count', auth, adminOnly, refundController.getPendingCount);

module.exports = router;

