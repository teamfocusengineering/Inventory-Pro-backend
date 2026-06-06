const mongoose = require('mongoose');

const productionLogSchema = new mongoose.Schema({
  qrId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'QRCode',
    required: true
  },
  code: { 
    type: String, 
    required: true
  },
  quantity: { 
    type: Number, 
    required: true,
    default: 0
  },
  stage: { 
    type: Number, 
    default: 1
  },
  stageType: { 
    type: String, 
    enum: ['manufacturing', 'processing', 'assembly'],
    default: 'manufacturing'
  },
  producedBy: { 
    type: String
  },
  operator: { 
    type: String
  },
  remarks: { 
    type: String
  },
  status: { 
    type: String, 
    enum: ['in_progress', 'completed', 'validated'],
    default: 'in_progress'
  },
  dealerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Dealer' 
  }
}, { timestamps: true });

productionLogSchema.index({ qrId: 1 });
productionLogSchema.index({ code: 1, createdAt: -1 });

module.exports = mongoose.model('ProductionLog', productionLogSchema);

