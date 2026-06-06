const mongoose = require('mongoose');

const inspectionScanLogSchema = new mongoose.Schema({
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'QRCode', required: false },
  qrId: { type: String, required: true },
  itemId: { type: String, default: '' },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeName: { type: String, default: '' },
  productName: { type: String, default: '' },
  code: { type: String, required: true, index: true },
  batchNo: { type: String, default: '' },
  partDescription: { type: String, default: '' },
  stageNumber: { type: Number, default: 1 },
  stageName: { type: String, default: '' },
  status: {
    type: String,
    enum: ['SCANNED', 'ACCEPTED', 'REJECTED', 'REWORK'],
    default: 'SCANNED'
  },
  actionTaken: { type: String, default: 'SCAN' },
  remarks: { type: String, default: '' },
  location: { type: String, default: '' },
  metadata: { type: Object, default: {} }
}, { timestamps: true });

inspectionScanLogSchema.index({ code: 1, updatedAt: -1 });
inspectionScanLogSchema.index({ employee: 1, createdAt: -1 });

module.exports = mongoose.model('InspectionScanLog', inspectionScanLogSchema);


