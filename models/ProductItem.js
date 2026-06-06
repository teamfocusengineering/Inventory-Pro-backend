const mongoose = require('mongoose');

const productItemSchema = new mongoose.Schema(
  {
    // The root product definition (inventory source)
    rootProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },

    // Root Code, e.g. MTR001
    rootCode: {
      type: String,
      required: true,
      index: true
    },

    // Item-level code, e.g. MTR001001
    code: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // 1..N
    itemNumber: {
      type: Number,
      required: true,
      index: true
    },

    // Derived: which item belongs to which manufacturing stage transitions
    // (kept minimal for now; ProcessingStage will be refactored to use these fields)
    dealerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dealer'
    }
  },
  { timestamps: true }
);

productItemSchema.index({ rootCode: 1, itemNumber: 1 }, { unique: true });

module.exports = mongoose.model('ProductItem', productItemSchema);



