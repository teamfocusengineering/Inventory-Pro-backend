const mongoose = require('mongoose');

const qrCodeSchema = new mongoose.Schema({
  qrId: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => `QR-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`
  },
  code: { 
    type: String, 
    required: true,
    ref: 'Product'
  },
  batchNo: { 
    type: String,
    trim: true
  },
  quantity: { 
    type: Number, 
    default: 0
  },
  status: { 
    type: String, 
    enum: ['generated', 'in_production', 'processing', 'completed', 'used_in_assembly', 'void', 'accepted', 'rejected', 'rework'],
    default: 'generated'
  },
  currentStage: { 
    type: Number, 
    default: 0
  },
  stagesCompleted: [{
    stageNumber: Number,
    stageType: { type: String, enum: ['manufacturing', 'processing', 'assembly'] },
    completedAt: Date,
    quantity: Number,
    operator: String,
    validated: { type: Boolean, default: false }
  }],
  weightData: {
    totalWeight: Number,
    unitWeight: Number,
    calculatedQuantity: Number,
    validated: { type: Boolean, default: false }
  },
  createdBy: { 
    type: String
  },
  dealerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Dealer' 
  }
}, { timestamps: true });

qrCodeSchema.index({ qrId: 1 });
qrCodeSchema.index({ code: 1, status: 1 });

module.exports = mongoose.model('QRCode', qrCodeSchema);


