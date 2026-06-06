const mongoose = require('mongoose');

const rawMaterialSchema = new mongoose.Schema({
  qrId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'QRCode',
    required: true
  },
  code: { 
    type: String, 
    required: true
  },
  batchNo: { 
    type: String,
    required: true
  },
  totalWeight: { 
    type: Number, 
    required: true
  },
  unitWeight: { 
    type: Number,
    required: true
  },
  calculatedQuantity: { 
    type: Number,
    required: true
  },
  actualQuantity: { 
    type: Number,
    default: 0
  },
  weightTolerance: { 
    type: Number,
    default: 0.05
  },
  status: { 
    type: String, 
    enum: ['pending_validation', 'validated', 'rejected', 'in_production'],
    default: 'pending_validation'
  },
  validationResult: {
    isValid: { type: Boolean, default: false },
    variance: Number,
    remarks: String
  },
  validatedBy: { 
    type: String
  },
  dealerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Dealer' 
  }
}, { timestamps: true });

rawMaterialSchema.index({ qrId: 1 });
rawMaterialSchema.index({ batchNo: 1 });

module.exports = mongoose.model('RawMaterial', rawMaterialSchema);

