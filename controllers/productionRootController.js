const Product = require('../models/Product');
const ProductItem = require('../models/ProductItem');
const ManufacturingConfig = require('../models/ManufacturingConfig');
const ProcessingStage = require('../models/ProcessingStage');
const { syncStageOneInputQuantity } = require('../utils/processingStageInventory');

const pad3 = (n) => String(n).padStart(3, '0');

const normalizerootCode = (s) => String(s || '').trim().toUpperCase();

const getFirstStage = async (rootProduct) => {
  // Configuration is stored by productName currently.
  const config = await ManufacturingConfig.findOne({
    productName: rootProduct.productName || rootProduct.description
  });

  const stages = config?.stages || [];
  const first = stages.sort((a, b) => a.stageNumber - b.stageNumber)[0];
  return first || {
    stageNumber: 1,
    stageName: 'Manufacturing',
    stageType: 'manufacturing'
  };
};

// POST /api/production-roots
// Body:
// { productName, rootCode, totalItems, withQR }
// Creates Product root record, ProductItem records, and auto-creates Stage 1 entry.
exports.createProductionRoot = async (req, res) => {
  try {
    const { productName, rootCode, numberOfItems } = req.body;

    // Backward compat (some older clients still send totalItems)
    const totalItems = numberOfItems ?? req.body?.totalItems;

    const withQR = Boolean(req.body?.withQR); // intentionally ignored for inventory/item generation


    if (!productName) return res.status(400).json({ message: 'productName is required' });
    if (!rootCode) return res.status(400).json({ message: 'rootCode is required' });

    const root = await Product.findOne({ code: normalizerootCode(rootCode) });
    if (root) {
      return res.status(400).json({ message: 'Root code already exists' });
    }

    const qty = Number(totalItems);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ message: 'totalItems must be a positive number' });
    }

    // Root product inventory source
    const rootProduct = await Product.create({
      // NOTE: Product model in this repo currently does NOT define `numberOfItems`.
      // Persist qty in both `numberOfItems` (new analytics expectation) and `stockQuantity` (existing schema).
      numberOfItems: qty,
      stockQuantity: qty,

      code: normalizerootCode(rootCode),
      productName,
      // minimal defaults for the Product schema
      description: productName,
      type: 'root',
      subType: null,
      minStockLevel: 0
    });

    const createdItems = [];
    for (let i = 1; i <= qty; i++) {
      const code = `${normalizerootCode(rootCode)}${pad3(i)}`;
      const item = await ProductItem.create({
        rootProductId: rootProduct._id,
        rootCode: normalizerootCode(rootCode),
        code,
        itemNumber: i,
        dealerId: rootProduct.dealerId
      });
      createdItems.push(item);
    }

    const firstStage = await getFirstStage(rootProduct);
    const stageCreated = await syncStageOneInputQuantity(rootProduct);

    return res.status(201).json({
      rootProduct,
      totalItems: qty,
      createdItemsCount: createdItems.length,
      firstStage,
      stageCreated
      // withQR
      // QR generation pending refactor
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



