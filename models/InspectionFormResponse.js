const mongoose = require('mongoose');

const inspectionAnswerSchema = new mongoose.Schema({
  questionId: String,
  question: String,
  type: String,
  answer: mongoose.Schema.Types.Mixed
}, { _id: false });

const inspectionFormResponseSchema = new mongoose.Schema({
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'QRCode' },
  productId: { type: String, default: '' },
  qrId: { type: String, default: '' },
  itemId: { type: String, default: '' },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeName: { type: String, default: '' },
  productName: { type: String, default: '' },
  code: { type: String, required: true, index: true },
  batchNo: { type: String, default: '' },
  partDescription: { type: String, default: '' },
  stageNumber: { type: Number, required: true },
  stageName: { type: String, required: true },
  formId: { type: String, default: '' },
  formName: { type: String, default: 'Stage Inspection' },
  inspectionResult: {
    type: String,
    enum: ['ACCEPTED', 'REJECTED', 'REWORK'],
    default: 'ACCEPTED'
  },
  acceptedCount: { type: Number, default: 0 },
  rejectedCount: { type: Number, default: 0 },
  reworkCount: { type: Number, default: 0 },
  responses: [inspectionAnswerSchema],
  rejectionFormResponses: [inspectionAnswerSchema],
  reworkFormResponses: [inspectionAnswerSchema],
  remarks: { type: String, default: '' },
  movement: {
    type: {
      type: String,
      enum: ['NONE', 'FORWARD', 'BACKWARD'],
      default: 'NONE'
    },
    fromStageNumber: Number,
    fromStageName: String,
    toStageNumber: Number,
    toStageName: String
  },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

inspectionFormResponseSchema.index({ code: 1, submittedAt: -1 });
inspectionFormResponseSchema.index({ employee: 1, submittedAt: -1 });
inspectionFormResponseSchema.index({ stageNumber: 1, inspectionResult: 1 });

module.exports = mongoose.model('InspectionFormResponse', inspectionFormResponseSchema);


