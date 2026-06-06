const express = require('express');
const router = express.Router();
const { auth, adminOnly, authAndEmployee } = require('../middleware/authMiddleware');
const brandModelController = require('../controllers/brandModelController');

// Public-ish for authenticated users (admins manage, employees can still view dropdowns)
router.get('/brands', auth, authAndEmployee, brandModelController.getActiveBrands);
router.get('/models', auth, authAndEmployee, brandModelController.getAllActiveModels);
router.get('/brands/models', auth, authAndEmployee, brandModelController.getAllActiveModels);
router.get('/brands/:brandId/models', auth, authAndEmployee, brandModelController.getActiveModelsByBrand);

// Admin management
router.post('/brands', auth, adminOnly, brandModelController.createBrand);
router.put('/brands/:id', auth, adminOnly, brandModelController.updateBrand);
router.delete('/brands/:id', auth, adminOnly, brandModelController.deleteBrand);

router.post('/brands/:brandId/models', auth, adminOnly, brandModelController.createModel);
router.put('/brands/models/:modelId', auth, adminOnly, brandModelController.updateModel);
router.delete('/brands/models/:modelId', auth, adminOnly, brandModelController.deleteModel);

module.exports = router;

