const express = require('express');
const router = express.Router();
const productionLogController = require('../controllers/productionLogController');

router.get('/', productionLogController.getAllProductionLogs);
router.get('/stats', productionLogController.getProductionStats);
router.get('/daily', productionLogController.getDailyProduction);
router.get('/:id', productionLogController.getProductionLogById);
router.post('/', productionLogController.createProductionLog);
router.put('/:id', productionLogController.updateProductionLog);

module.exports = router;