const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/authMiddleware');
const inspectionController = require('../controllers/inspectionController');

router.use(auth);

router.get('/employee/dashboard', inspectionController.getDashboard);
router.post('/employee/scan', inspectionController.scanQRCode);
router.post('/employee/submit', inspectionController.submitInspection);
router.get('/employee/scan-logs', inspectionController.getScanLogs);
router.get('/employee/traceability/:id', inspectionController.getTraceability);

router.get('/admin/responses', adminOnly, inspectionController.getAdminResponses);
router.get('/admin/production-analytics', adminOnly, inspectionController.getProductionAnalytics);
router.get('/admin/responses/:id', adminOnly, inspectionController.getResponseById);
router.get('/admin/traceability/:id', adminOnly, inspectionController.getTraceability);

module.exports = router;
