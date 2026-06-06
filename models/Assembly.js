const mongoose = require('mongoose');

const assemblySchema = new mongoose.Schema({
  assemblyNo: { 
    type: String, 
    required: true,
    unique: true,
    default: () => `ASSEMBLY-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`
  },
  helmetId: { 
    type: String,
    unique: true,
    sparse: true
  },
  components: [{
    qrId: { type: mongoose.Schema.Types.ObjectId, ref: 'QRCode' },
    code: String,
    quantityUsed: { type: Number, default: 1 },
    stage: Number
  }],
  finalQuantity: { 
    type: Number, 
    default: 0
  },
  assembledBy: { 
    type: String
  },
  assembledAt: { 
    type: Date,
    default: Date.now
  },
  status: { 
    type: String, 
    enum: ['in_progress', 'completed', 'finalized'],
    default: 'in_progress'
  },
  remarks: { 
    type: String
  },
  dealerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Dealer' 
  }
}, { timestamps: true });

assemblySchema.index({ assemblyNo: 1 });
assemblySchema.index({ status: 1 });

module.exports = mongoose.model('Assembly', assemblySchema);

