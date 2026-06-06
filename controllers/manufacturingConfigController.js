const ManufacturingConfig = require('../models/ManufacturingConfig');
const Product = require('../models/Product');

const getWorkflowType = (stages = []) => `${Math.max(stages.length, 1)}-step`;
const defaultStages = [
  {
    stageNumber: 1,
    stageName: 'Manufacturing',
    stageType: 'manufacturing',
    requiresValidation: false
  }
];

const normalizeStages = (stages) => {
  const sourceStages = Array.isArray(stages) && stages.length > 0 ? stages : defaultStages;

  return sourceStages.map((stage, index) => ({
    stageNumber: index + 1,
    stageName: String(stage.stageName || `Stage ${index + 1}`).trim(),
    stageType: index === 0 ? 'manufacturing' : (stage.stageType || 'processing'),
    description: stage.description,
    requiresValidation: Boolean(stage.requiresValidation),
    reviewForm: stage.reviewForm || { outcomes: [] }
  }));
};

const sendSaveError = (res, error) => {
  if (error.code === 11000) {
    const duplicateField = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'field';
    return res.status(400).json({
      message: `Configuration already exists for this ${duplicateField}`
    });
  }

  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors || {})
      .map((item) => item.message)
      .join(', ');
    return res.status(400).json({ message: message || error.message });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${error.path || 'id'}` });
  }

  console.error('Manufacturing config save failed:', error);
  return res.status(500).json({ error: error.message });
};

exports.getAllManufacturingConfigs = async (req, res) => {
  try {
    const { search, workflowType } = req.query;
    let query = {};

    if (search) {
      query.productName = { $regex: search, $options: 'i' };
    }

    if (workflowType) query.workflowType = workflowType;

    const configs = await ManufacturingConfig.find(query).sort({ updatedAt: -1 });
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getManufacturingConfigById = async (req, res) => {
  try {
    const config = await ManufacturingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getManufacturingConfigByCode = async (req, res) => {
  try {
    const product = await Product.findOne({
      $or: [
        { code: req.params.code },
        { code: req.params.code }
      ]
    });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const config = await ManufacturingConfig.findOne({ productName: product.productName || product.description });
    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createManufacturingConfig = async (req, res) => {
  try {
    const { productName, stages } = req.body;

    if (!productName) {
      return res.status(400).json({ message: 'productName is required' });
    }

    const product = await Product.findOne({ productName });
    if (!product) {
      return res.status(404).json({ message: 'Product not found for given productName' });
    }

    const existingConfig = await ManufacturingConfig.findOne({ productName });
    if (existingConfig) {
      return res.status(400).json({ message: 'Configuration already exists for this productName' });
    }

    const normalizedStages = normalizeStages(stages);

    const config = new ManufacturingConfig({
      productName: productName || product.productName || product.description,
      workflowType: getWorkflowType(normalizedStages),
      stages: normalizedStages
    });

    await config.save();
    res.status(201).json(config);
  } catch (error) {
    return sendSaveError(res, error);
  }
};

exports.updateManufacturingConfig = async (req, res) => {
  try {
    const config = await ManufacturingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }

    const { productName, workflowType, stages, isActive } = req.body;

    if (productName !== undefined && productName !== config.productName) {
      const product = await Product.findOne({ productName });
      if (!product) {
        return res.status(404).json({ message: 'Product not found for given productName' });
      }

      const existingConfig = await ManufacturingConfig.findOne({
        productName,
        _id: { $ne: config._id }
      });
      if (existingConfig) {
        return res.status(400).json({ message: 'Configuration already exists for this productName' });
      }

      config.productName = productName;
    }

    if (stages) {
      const normalizedStages = normalizeStages(stages);
      config.stages = normalizedStages;
      config.workflowType = getWorkflowType(normalizedStages);
    } else if (workflowType) {
      config.workflowType = workflowType;
    }
    if (isActive !== undefined) config.isActive = isActive;

    await config.save();
    res.json(config);
  } catch (error) {
    return sendSaveError(res, error);
  }
};

exports.deleteManufacturingConfig = async (req, res) => {
  try {
    const config = await ManufacturingConfig.findByIdAndDelete(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: get review form definitions (per workflow stage)
// Payload shape is flexible because the UI can evolve.
exports.getReviewForms = async (req, res) => {
  try {
    const config = await ManufacturingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }

    res.json({
      productName: config.productName,
      workflowType: config.workflowType,
      stages: config.stages.map((s) => ({
        stageNumber: s.stageNumber,
        stageName: s.stageName,
        stageType: s.stageType,
        reviewForm: s.reviewForm || { outcomes: [] }
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: save review form definitions (per workflow stage)
// Expected body: { stages: [{ stageNumber, reviewForm }] }
exports.saveReviewForms = async (req, res) => {
  try {
    const config = await ManufacturingConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }

    const { stages } = req.body;
    if (!Array.isArray(stages)) {
      return res.status(400).json({ message: '`stages` array is required' });
    }

    const stageByNumber = new Map(stages.map((s) => [Number(s.stageNumber), s]));

    config.stages = config.stages.map((existingStage) => {
      const incoming = stageByNumber.get(Number(existingStage.stageNumber));
      if (!incoming) return existingStage;

      return {
        ...existingStage.toObject(),
        reviewForm: incoming.reviewForm || { outcomes: [] }
      };
    });

    await config.save();

    res.json({ message: 'Review forms saved', config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.validateStageSequence = async (req, res) => {
  try {
    const { qrId, stageNumber } = req.body;

    const QRCode = require('../models/QRCode');
    const qrCode = await QRCode.findById(qrId);

    if (!qrCode) {
      return res.status(404).json({ message: 'QR Code not found' });
    }

    // QRCode -> Product (by code) -> ManufacturingConfig (by productName)
    const product = await Product.findOne({
      $or: [{ code: qrCode.code }, { code: qrCode.code }]
    });
    if (!product) {
      return res.status(404).json({ message: 'Product not found for QR code' });
    }

    const config = await ManufacturingConfig.findOne({
      productName: product.productName || product.description
    });

    if (!config) {
      return res.status(404).json({ message: 'Configuration not found' });
    }

    const expectedSequence = config.stages.map(s => s.stageNumber).sort((a, b) => a - b);
    const nextExpectedStage = Math.min(...expectedSequence.filter(s => s > qrCode.currentStage));

    if (stageNumber !== nextExpectedStage && nextExpectedStage !== undefined) {
      return res.status(400).json({
        valid: false,
        message: `Stage ${stageNumber} cannot be performed before stage ${nextExpectedStage}`
      });
    }

    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



