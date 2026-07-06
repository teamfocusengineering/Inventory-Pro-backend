const express = require('express');
const router = express.Router();
const { auth, authAndEmployee } = require('../middleware/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

// @route   GET /api/dashboard/stats
// @desc    Get dashboard statistics
router.get('/stats', auth, authAndEmployee, dashboardController.getStats);

// @route   GET /api/dashboard/low-stock
// @desc    Get low stock products
router.get('/low-stock', auth, authAndEmployee, dashboardController.getLowStock);

// @route   GET /api/dashboard/sales-chart
// @desc    Get sales data for chart (last 7 days)
router.get('/sales-chart', auth, authAndEmployee, dashboardController.getSalesChart);

// @route   GET /api/dashboard/category-distribution
// @desc    Get product count by category
router.get('/category-distribution', auth, authAndEmployee, dashboardController.getCategoryDistribution);

// @route   GET /api/dashboard/top-products
// @desc    Get top selling products
router.get('/top-products', auth, authAndEmployee, dashboardController.getTopProducts);

// @route   GET /api/dashboard/employee-sales
// @desc    Get employee sales progress for date range
router.get('/employee-sales', auth, authAndEmployee, dashboardController.getEmployeeSalesProgress);

module.exports = router;

