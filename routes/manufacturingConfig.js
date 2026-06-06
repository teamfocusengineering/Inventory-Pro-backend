const express = require('express');
const router = express.Router();
const manufacturingConfigController = require('../controllers/manufacturingConfigController');

router.get('/', manufacturingConfigController.getAllManufacturingConfigs);
// IMPORTANT: place these routes BEFORE '/:id' to avoid them being captured by the :id param
router.get('/code/:code', manufacturingConfigController.getManufacturingConfigByCode);
router.get('/part/:code', manufacturingConfigController.getManufacturingConfigByCode);
router.get('/:id', manufacturingConfigController.getManufacturingConfigById);
router.post('/', manufacturingConfigController.createManufacturingConfig);
router.post('/validate-stage', manufacturingConfigController.validateStageSequence);

// Admin: review form builder (dynamic question tree)
router.get('/:id/review-forms', manufacturingConfigController.getReviewForms);
router.put('/:id/review-forms', manufacturingConfigController.saveReviewForms);

router.put('/:id', manufacturingConfigController.updateManufacturingConfig);
router.delete('/:id', manufacturingConfigController.deleteManufacturingConfig);


module.exports = router;


