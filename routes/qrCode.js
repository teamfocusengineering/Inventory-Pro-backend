const express = require('express');
const router = express.Router();
const qrCodeController = require('../controllers/qrCodeController');

router.get('/', qrCodeController.getAllQRCodes);
router.get('/stats', qrCodeController.getQRCodeStats);
router.get('/:id', qrCodeController.getQRCodeById);
router.get('/qr/:qrId', qrCodeController.getQRCodeByQRId);
router.post('/', qrCodeController.createQRCode);
router.post('/bulk', qrCodeController.bulkCreateQRCodes);
router.put('/:id', qrCodeController.updateQRCode);
router.put('/:id/progress', qrCodeController.updateQRCodeProgress);
router.delete('/:id', qrCodeController.deleteQRCode);

module.exports = router;