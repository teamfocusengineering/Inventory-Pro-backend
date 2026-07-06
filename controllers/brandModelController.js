const Brand = require('../models/Brand');
const BrandModel = require('../models/BrandModel');

// @desc    Get all active brands
// @route   GET /api/brands
exports.getActiveBrands = async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true }).sort({ name: 1 });
    res.json(brands);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create brand (Admin)
// @route   POST /api/brands
exports.createBrand = async (req, res) => {
  try {
    const { name, isActive } = req.body;
    if (!name) return res.status(400).json({ message: 'Brand name is required' });

    const brand = new Brand({ name, isActive: isActive ?? true });
    await brand.save();
    res.status(201).json(brand);
  } catch (error) {
    // handle duplicate key
    if (error && error.code === 11000) {
      return res.status(400).json({ message: 'Brand already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update brand (Admin)
// @route   PUT /api/brands/:id
exports.updateBrand = async (req, res) => {
  try {
    const { name, isActive } = req.body;
    const brand = await Brand.findByIdAndUpdate(
      req.params.id,
      { ...(name !== undefined ? { name } : {}), ...(isActive !== undefined ? { isActive } : {}) },
      { new: true }
    );

    if (!brand) return res.status(404).json({ message: 'Brand not found' });
    res.json(brand);
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ message: 'Brand already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete brand (Admin)
// @route   DELETE /api/brands/:id
exports.deleteBrand = async (req, res) => {
  try {
    const brand = await Brand.findByIdAndDelete(req.params.id);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    // Hard delete models too (keeps referential consistency)
    await BrandModel.deleteMany({ brandId: brand._id });

    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get active models by brandId
// @route   GET /api/brands/:brandId/models
exports.getActiveModelsByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const models = await BrandModel.find({ brandId, isActive: true })
      .sort({ name: 1 });
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get all active models
// @route   GET /api/brands/models
exports.getAllActiveModels = async (req, res) => {
  try {
    const models = await BrandModel.find({ isActive: true })
      .sort({ name: 1 })
      .populate('brandId', 'name');
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create model (Admin)
// @route   POST /api/brands/:brandId/models
exports.createModel = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { name, isActive } = req.body;
    if (!name) return res.status(400).json({ message: 'Model name is required' });

    // Ensure brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    const model = new BrandModel({ brandId, name, isActive: isActive ?? true });
    await model.save();
    res.status(201).json(model);
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ message: 'Model already exists for this brand' });
    }
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update model (Admin)
// @route   PUT /api/brands/models/:modelId
exports.updateModel = async (req, res) => {
  try {
    const { name, brandId, isActive } = req.body;

    const payload = {
      ...(name !== undefined ? { name } : {}),
      ...(isActive !== undefined ? { isActive } : {})
    };

    // Optional: allow changing brandId only if provided
    if (brandId !== undefined) payload.brandId = brandId;

    const model = await BrandModel.findByIdAndUpdate(req.params.modelId, payload, { new: true });
    if (!model) return res.status(404).json({ message: 'Model not found' });

    res.json(model);
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ message: 'Model already exists for this brand' });
    }
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete model (Admin)
// @route   DELETE /api/brands/models/:modelId
exports.deleteModel = async (req, res) => {
  try {
    const model = await BrandModel.findByIdAndDelete(req.params.modelId);
    if (!model) return res.status(404).json({ message: 'Model not found' });
    res.json({ message: 'Model deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

