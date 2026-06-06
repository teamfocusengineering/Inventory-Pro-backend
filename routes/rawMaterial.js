const express = require('express');
const router = express.Router();
const rawMaterialController = require('../controllers/rawMaterialController');

router.get('/', rawMaterialController.getAllRawMaterials);
router.get('/stats', rawMaterialController.getRawMaterialStats);
router.get('/:id', rawMaterialController.getRawMaterialById);
router.post('/', rawMaterialController.createRawMaterial);
router.put('/:id', rawMaterialController.updateRawMaterialQuantity);
router.put('/:id/validate', rawMaterialController.validateRawMaterial);

module.exports = router;