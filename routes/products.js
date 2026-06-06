const express = require('express');
const router = express.Router();
const { auth, adminOnly, authAndEmployee } = require('../middleware/authMiddleware');
const productsController = require('../controllers/productsController');

// @route   GET /api/products
// @desc    Get all products (with optional search/filter)
router.get('/', auth, authAndEmployee, productsController.getProducts);

// @route   GET /api/products/code/:code
// @desc    Get product by barcode/code
router.get('/code/:code', auth, authAndEmployee, productsController.getProductByCode);

// @route   GET /api/products/low-stock/all
// @desc    Get all low stock products
router.get('/low-stock/all', auth, authAndEmployee, productsController.getLowStockProducts);

// @route   GET /api/products/:id
// @desc    Get single product by ID
router.get('/:id', auth, authAndEmployee, productsController.getProductById);

// @route   POST /api/products
// @desc    Create new product (Admin only)
router.post('/', auth, adminOnly, productsController.createProduct);

// @route   POST /api/products/bulk-upload
// @desc    Bulk upload products from parsed Excel rows (Admin only)
router.post('/bulk-upload', auth, adminOnly, productsController.bulkUploadProducts);

// @route   PUT /api/products/:id
// @desc    Update product (Admin only)
router.put('/:id', auth, adminOnly, productsController.updateProduct);

// @route   DELETE /api/products/:id
// @desc    Delete product (Admin only)
router.delete('/:id', auth, adminOnly, productsController.deleteProduct);

// Category Routes
// @route   GET /api/products/categories/all
// @desc    Get all categories
router.get('/categories/all', auth, authAndEmployee, productsController.getCategories);

// @route   POST /api/products/categories
// @desc    Create category (Admin only)
router.post('/categories', auth, adminOnly, productsController.createCategory);

// @route   PUT /api/products/categories/:id
// @desc    Update category (Admin only)
router.put('/categories/:id', auth, adminOnly, productsController.updateCategory);

// @route   DELETE /api/products/categories/:id
// @desc    Delete category (Admin only)
router.delete('/categories/:id', auth, adminOnly, productsController.deleteCategory);

// Subcategory Routes
// @route   GET /api/products/subcategories/all
// @desc    Get all subcategories or by category
router.get('/subcategories/all', auth, authAndEmployee, productsController.getSubcategories);

// @route   POST /api/products/subcategories
// @desc    Create subcategory (Admin only)
router.post('/subcategories', auth, adminOnly, productsController.createSubcategory);

// @route   PUT /api/products/subcategories/:id
// @desc    Update subcategory (Admin only)
router.put('/subcategories/:id', auth, adminOnly, productsController.updateSubcategory);

// @route   DELETE /api/products/subcategories/:id
// @desc    Delete subcategory (Admin only)
router.delete('/subcategories/:id', auth, adminOnly, productsController.deleteSubcategory);

// @route   GET /api/products/:id/analytics
// @desc    Get product analytics popup data
router.get('/:id/analytics', auth, authAndEmployee, productsController.getProductAnalytics);

module.exports = router;



