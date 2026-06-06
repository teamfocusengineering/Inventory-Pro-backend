const mongoose = require('mongoose');

const manufacturingConfigSchema = new mongoose.Schema({
  productName: { 
    type: String, 
    required: true,
    trim: true,
    unique: true
  },
  workflowType: { 
    type: String, 
    required: true,
    trim: true,
    validate: {
      validator: (value) => /^[1-9]\d*-step$/.test(value),
      message: 'workflowType must use the format "N-step"'
    }
  },
  stages: [{
    stageNumber: { type: Number, required: true },
    stageName: { type: String, required: true },
    stageType: { type: String, enum: ['manufacturing', 'processing', 'assembly'], required: true },
    description: String,
    requiresValidation: { type: Boolean, default: false },

    // Admin: dynamic review form definition (question tree with branching)
    // Structure is intentionally flexible to support dropdown/checkbox/multiple-choice + sub-branches.
    reviewForm: {
      type: Object,
      default: {
        outcomes: []
      }
    }
  }],
  isActive: { 
    type: Boolean, 
    default: true 
  },
  dealerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Dealer' 
  }
}, { timestamps: true });

manufacturingConfigSchema.index({ workflowType: 1 });

module.exports = mongoose.model('ManufacturingConfig', manufacturingConfigSchema);
