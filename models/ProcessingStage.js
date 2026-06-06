const mongoose = require('mongoose');

const processingStageSchema = new mongoose.Schema({
  qrId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'QRCode',
    required: false
  },
  code: { 
    type: String, 
    required: true
  },
  stageNumber: { 
    type: Number, 
    required: true
  },
  stageName: { 
    type: String, 
    required: true
  },
  inputQuantity: { 
    type: Number, 
    required: true
  },
  outputQuantity: { 
    type: Number, 
    default: 0
  },
  acceptedQuantity: {
    type: Number,
    default: 0
  },
  rejectedQuantity: {
    type: Number,
    default: 0
  },
  reworkQuantity: {
    type: Number,
    default: 0
  },
  operator: { 
    type: String
  },
  processedAt: { 
    type: Date,
    default: Date.now
  },
  validated: { 
    type: Boolean, 
    default: false
  },
  validatedBy: { 
    type: String
  },
  validationRemarks: { 
    type: String
  },

  // Stage review management (Admin)
  reviewStatus: {
    type: String,
    enum: ['accepted', 'rejected', 'pending', 'rework'],
    default: 'pending'
  },

  // Legacy field (still used for rejected)
  rejectionReason: {
    type: String,
    default: ''
  },

  // New: dynamic answers captured from the admin review form
  reviewAnswers: {
    // key-value object keyed by question ids
    type: Object,
    default: {}
  },

  // New: reference to the form definition version stored in ManufacturingConfig
  reviewFormVersion: {
    type: String,
    default: ''
  },

  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'completed', 'validated', 'skipped'],
    default: 'pending'
  },
  dealerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Dealer' 
  }
}, { timestamps: true });

processingStageSchema.index({ qrId: 1 });
processingStageSchema.index({ qrId: 1, stageNumber: 1 });
processingStageSchema.index({ code: 1, stageNumber: 1 });

module.exports = mongoose.model('ProcessingStage', processingStageSchema);


