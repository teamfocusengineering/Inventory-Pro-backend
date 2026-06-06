const Product = require('../models/Product');
const { syncStageOneInputQuantity } = require('../utils/processingStageInventory');

const normalizeCode = (value) => String(value || '').trim().toUpperCase();

exports.getAllProductMasters = async (req, res) => {
  try {
    const { search, type, subType, isActive } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } }
      ];
    }

    if (type) query.type = type;
    if (subType) query.subType = subType;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const products = await Product.find(query).sort({ updatedAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductMasterById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductMasterByCode = async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const product = await Product.findOne({ code });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createProductMaster = async (req, res) => {
  try {
    const { code, description, productName, type, subType, unitWeight, unit, numberOfItems } = req.body;
    const resolvedCode = normalizeCode(code);

    const existingProduct = await Product.findOne({
      code: resolvedCode
    });
    if (existingProduct) {
      return res.status(400).json({ message: 'Code already exists' });
    }

    const product = new Product({
      code: resolvedCode,
      productName: productName || description || 'Untitled',
      description,
      type,
      subType,
      unitWeight,
      unit,
      numberOfItems: Number(numberOfItems || 0),
      stockQuantity: Number(numberOfItems || 0)
    });

    await product.save();
    await syncStageOneInputQuantity(product);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateProductMaster = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const { code, description, productName, type, subType, unitWeight, unit, numberOfItems, isActive } = req.body;

    const resolvedCode = normalizeCode(code);

    if (resolvedCode && resolvedCode !== product.code) {
      const existing = await Product.findOne({
        _id: { $ne: product._id },
        code: resolvedCode
      });
      if (existing) {
        return res.status(400).json({ message: 'Code already exists' });
      }
      product.code = resolvedCode;
    }

    if (productName !== undefined) product.productName = productName;
    if (description !== undefined) product.description = description;
    if (type !== undefined) product.type = type;
    if (subType !== undefined) product.subType = subType;
    if (unitWeight !== undefined) product.unitWeight = unitWeight;
    if (unit !== undefined) product.unit = unit;
    if (numberOfItems !== undefined) {
      product.numberOfItems = Number(numberOfItems || 0);
      product.stockQuantity = Number(numberOfItems || 0);
    }
    if (isActive !== undefined) product.isActive = isActive;

    await product.save();
    await syncStageOneInputQuantity(product);
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteProductMaster = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.uploadProductMasters = async (req, res) => {
  try {
    const { products } = req.body;
    
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'No products provided' });
    }

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const item of products) {
      try {
        const code = normalizeCode(item.code);
        const existing = await Product.findOne({ code });
        
        if (existing) {
          existing.productName = item.productName || item.description || existing.productName;
          existing.description = item.description || existing.description;
          existing.type = item.type || existing.type;
          existing.subType = item.subType || existing.subType;
          await existing.save();
          results.updated++;
        } else {
          const product = new Product({
            code,
            productName: item.productName || item.description || 'Untitled',
            description: item.description,
            type: item.type,
            subType: item.subType
          });
          await product.save();
          results.created++;
        }
      } catch (err) {
        results.errors.push({ code: item.code, error: err.message });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductTypes = async (req, res) => {
  try {
    const types = await Product.distinct('type', { type: { $ne: null } });
    res.json(types);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductSubTypes = async (req, res) => {
  try {
    const { type } = req.query;
    let query = { subType: { $ne: null } };
    if (type) query.type = type;
    
    const subTypes = await Product.distinct('subType', query);
    res.json(subTypes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



