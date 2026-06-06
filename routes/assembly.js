const express = require('express');
const router = express.Router();
const assemblyController = require('../controllers/assemblyController');

router.get('/', assemblyController.getAllAssemblies);
router.get('/stats', assemblyController.getAssemblyStats);
router.get('/daily', assemblyController.getDailyAssembly);
router.get('/:id', assemblyController.getAssemblyById);
router.post('/', assemblyController.createAssembly);
router.put('/:id', assemblyController.updateAssembly);
router.put('/:id/finalize', assemblyController.finalizeAssembly);

module.exports = router;