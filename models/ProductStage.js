const mongoose = require('mongoose');

const productStageSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    code: {
      type: String,
      required: true,
      index: true
    },
    stageNumber: {
      type: Number,
      required: true,
      index: true
    },
    stageName: {
      type: String,
      required: true
    },

    // Source-of-truth quantity counters (derived from Product.quantity at creation time)
    availableQuantity: {
      type: Number,
      required: true,
      default: 0
    },
    acceptedCount: {
      type: Number,
      required: true,
      default: 0
    },
    rejectedCount: {
      type: Number,
      required: true,
      default: 0
    },
    reworkCount: {
      type: Number,
      required: true,
      default: 0
    },
    pendingCount: {
      type: Number,
      required: true,
      default: 0
    }
  },
  { timestamps: true }
);

productStageSchema.index({ productId: 1, stageNumber: 1 }, { unique: true });

module.exports = mongoose.model('ProductStage', productStageSchema);



