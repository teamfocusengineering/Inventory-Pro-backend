const express = require('express');
const { auth, adminOnly } = require('../middleware/authMiddleware');
const controller = require('../controllers/misOperationsController');

const router = express.Router();
router.use(auth);

router.get('/employee-sheet-entries', controller.getEmployeeMisSheetEntries);
router.post('/employee-sheet-entries', controller.upsertEmployeeMisSheetEntry);

router.get('/bop-receipts', controller.getBopReceipts);
router.get('/supplier-rejections', controller.getSupplierRejections);

router.use(adminOnly);

router.post('/bop-receipts', controller.createBopReceipt);
router.put('/bop-receipts/:id', controller.updateBopReceipt);
router.delete('/bop-receipts/:id', controller.deleteBopReceipt);

router.post('/supplier-rejections', controller.createSupplierRejection);
router.put('/supplier-rejections/:id', controller.updateSupplierRejection);
router.delete('/supplier-rejections/:id', controller.deleteSupplierRejection);

router.get('/shell-moulding-inspections', controller.getShellMouldingInspectionEntries);
router.post('/shell-moulding-inspections', controller.upsertShellMouldingInspectionEntry);

router.get('/visor-pdiir-inspections', controller.getVisorPdiirInspectionEntries);
router.post('/visor-pdiir-inspections', controller.upsertVisorPdiirInspectionEntry);

module.exports = router;
