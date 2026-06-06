const mongoose = require('mongoose');

const stageMovementLogSchema = new mongoose.Schema({
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'QRCode', required: true },
  qrId: { type: String, required: true },
  itemId: { type: String, default: '' },
  code: { type: String, required: true, index: true },
  batchNo: { type: String, default: '' },
  productName: { type: String, default: '' },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeName: { type: String, default: '' },
  fromStageNumber: { type: Number, required: true },
  fromStageName: { type: String, required: true },
  toStageNumber: { type: Number, required: true },
  toStageName: { type: String, required: true },
  movementType: {
    type: String,
    enum: ['FORWARD', 'BACKWARD'],
    required: true
  },
  remarks: { type: String, default: '' },
  movedAt: { type: Date, default: Date.now }
}, { timestamps: true });

stageMovementLogSchema.index({ code: 1, movedAt: -1 });
stageMovementLogSchema.index({ qrCode: 1, movedAt: -1 });

module.exports = mongoose.model('StageMovementLog', stageMovementLogSchema);


