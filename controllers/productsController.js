const Product = require('../models/Product');
const Category = require('../models/Category');
const Subcategory = require('../models/Subcategory');
const Invoice = require('../models/Invoice');
const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const BrandModel = require('../models/BrandModel');
const { syncStageOneInputQuantity } = require('../utils/processingStageInventory');
const QRCode = require('../models/QRCode');
const DefectDetail = require('../models/DefectDetail');
const ManufacturingConfig = require('../models/ManufacturingConfig');
const StageReviewConfig = require('../models/StageReviewConfig');

// @desc    Get all products (with optional search/filter)
// @route   GET /api/products
exports.getProducts = async (req, res) => {
  try {
    const { search, category, subcategory, lowStock } = req.query;
    let query = { isDeleted: false }; // Only show non-deleted products

    if (search) {
      query.$or = [
        { productName: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } }
      ];
    }

    if (category) {
      query.category = category;
    }

    if (subcategory) {
      query.subcategory = subcategory;
    }

    if (lowStock === 'true') {
      query.$expr = { $lte: ['$stockQuantity', '$minStockLevel'] };
    }

    const products = await Product.find(query)
      .populate('category', 'name')
      .populate('subcategory', 'name')
      .sort({ updatedAt: -1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get single product by ID
// @route   GET /api/products/:id
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name')
      .populate('subcategory', 'name');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get product by barcode/code
// @route   GET /api/products/code/:code
exports.getProductByCode = async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const product = await Product.findOne({
      $or: [{ code }],
      isDeleted: false
    })
      .populate('category', 'name')
      .populate('subcategory', 'name');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Helper: resolve brand/model IDs to strings
const resolveBrandModelStrings = async ({ brandId, modelId, brandName, model }) => {
  // If IDs provided, prefer them
  if (brandId && modelId) {
    const brand = await Brand.findById(brandId);
    const m = await BrandModel.findById(modelId);

    if (!brand) throw new Error('Brand not found');
    if (!m) throw new Error('Model not found');
    if (m.brandId?.toString() !== brand._id.toString()) {
      throw new Error('Model does not belong to the selected brand');
    }

    return {
      brandName: brand.name,
      model: m.name
    };
  }

  // Backward compatibility: allow strings if IDs not provided
  return {
    brandName: brandName ?? null,
    model: model ?? null
  };
};

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeCode = (value) => String(value || '').trim().toUpperCase();

const generateCode = async () => {
  let code = '';
  let exists = true;
  while (exists) {
    code = `PRT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    exists = await Product.exists({ code });
  }
  return code;
};

const ensureBrandAndModel = async ({ brandName, model }) => {
  const brandNames = splitList(brandName);
  const modelNames = splitList(model);
  const cleanBrand = brandNames[0];
  const cleanModel = modelNames[0];

  if (!cleanBrand) return { brandName: brandName || null, model: model || null };

  const brands = [];
  for (const name of brandNames) {
    const brand = await Brand.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, isActive: true } },
      { new: true, upsert: true }
    );
    brands.push(brand);
  }

  if (modelNames.length) {
    for (const [index, modelName] of modelNames.entries()) {
      const brand = brands[index] || brands[0];
      await BrandModel.findOneAndUpdate(
        { brandId: brand._id, name: modelName },
        { $setOnInsert: { brandId: brand._id, name: modelName, isActive: true } },
        { new: true, upsert: true }
      );
    }
  }

  return {
    brandName: brandNames.join(', '),
    model: modelNames.join(', ') || null
  };
};

const ensureDefects = async (type, names) => {
  for (const name of splitList(names)) {
    await DefectDetail.findOneAndUpdate(
      { type, name },
      { $setOnInsert: { type, name, isActive: true } },
      { new: true, upsert: true }
    );
  }
};

const ensureCategoryAndSubcategory = async ({ categoryName, subcategoryName }) => {
  const cleanCategory = String(categoryName || '').trim();
  const cleanSubcategory = String(subcategoryName || '').trim();

  if (!cleanCategory) return { category: undefined, subcategory: undefined };

  const category = await Category.findOneAndUpdate(
    { name: cleanCategory },
    { $setOnInsert: { name: cleanCategory, isActive: true } },
    { new: true, upsert: true }
  );

  if (!cleanSubcategory) return { category: category._id, subcategory: undefined };

  const subcategory = await Subcategory.findOneAndUpdate(
    { name: cleanSubcategory, category: category._id },
    { $setOnInsert: { name: cleanSubcategory, category: category._id, isActive: true } },
    { new: true, upsert: true }
  );

  return { category: category._id, subcategory: subcategory._id };
};

const toBoolean = (value) =>
  ['true', 'yes', '1', 'y', 'with qr', 'withqr'].includes(String(value ?? '').trim().toLowerCase());

const responseTypeFromOptionType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['multichoice', 'multi choice', 'multiplechoice', 'multiple choice', 'checkbox'].includes(normalized)) return 'checkbox';
  if (['dropdown', 'select'].includes(normalized)) return 'dropdown';
  if (['radio', 'singlechoice', 'single choice'].includes(normalized)) return 'radio';
  return 'text';
};

const buildReviewQuestions = ({ type, questionText, optionType, options }) => {
  const optionLabels = splitList(options);
  const cleanQuestionText = String(questionText || '').trim();
  if (!cleanQuestionText && !optionType && !optionLabels.length) return [];

  return [{
    questionId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    questionText: cleanQuestionText || `${type === 'rejection' ? 'Rejected' : 'Rework'} option`,
    responseType: responseTypeFromOptionType(optionType),
    required: optionLabels.length > 0,
    options: optionLabels.map((label, index) => ({
      optionId: `${type}-option-${index + 1}`,
      label,
      value: label,
      subQuestions: []
    }))
  }];
};

const stageNameFromNumber = (stageNumber) => `Stage ${stageNumber}`;

const acceptedRouteForStage = (stage, stageNumbers) => {
  const rawValue = String(stage.accepted || '').trim();
  const explicitNumber = Number(rawValue);
  if (Number.isFinite(explicitNumber) && stageNumbers.includes(explicitNumber)) return String(explicitNumber);

  const stageNameMatch = rawValue.match(/stage\s*(\d+)/i);
  if (stageNameMatch) {
    const stageNumber = Number(stageNameMatch[1]);
    if (stageNumbers.includes(stageNumber)) return String(stageNumber);
  }

  const nextStage = stageNumbers.find((stageNumber) => stageNumber > stage.stageNumber);
  return nextStage ? String(nextStage) : '';
};

const syncWorkflowTemplate = async ({ productName, code, workflowStages = [] }) => {
  const normalizedStages = workflowStages
    .map((stage, index) => ({
      stageNumber: Number(stage.stageNumber || index + 1),
      stageName: String(stage.stageName || '').trim(),
      enabled: stage.enabled,
      accepted: stage.accepted,
      rejectionQuestion: stage.rejectionQuestion,
      rejectionOptionType: stage.rejectionOptionType,
      rejectionOptions: stage.rejectionOptions,
      reworkQuestion: stage.reworkQuestion,
      reworkOptionType: stage.reworkOptionType,
      reworkOptions: stage.reworkOptions
    }))
    .filter((stage) => {
      const enabledValue = String(stage.enabled ?? stage.stageName ?? '').trim().toLowerCase();
      return stage.stageNumber && enabledValue && !['no', 'false', '0', 'n'].includes(enabledValue);
    });

  if (!normalizedStages.length) return null;

  const stageNumbers = normalizedStages.map((stage) => stage.stageNumber).sort((a, b) => a - b);
  const manufacturingStages = normalizedStages.map((stage, index) => {
    const rejectionQuestions = buildReviewQuestions({
      type: 'rejection',
      questionText: stage.rejectionQuestion,
      optionType: stage.rejectionOptionType,
      options: stage.rejectionOptions
    });
    const reworkQuestions = buildReviewQuestions({
      type: 'rework',
      questionText: stage.reworkQuestion,
      optionType: stage.reworkOptionType,
      options: stage.reworkOptions
    });

    return {
    stageNumber: stage.stageNumber,
    stageName: stage.stageName || stageNameFromNumber(stage.stageNumber),
    stageType: index === 0 ? 'manufacturing' : 'processing',
    requiresValidation: false,
    reviewForm: {
      questions: [],
      rejectionForm: {
        formId: `stage-${stage.stageNumber}-rejection-admin`,
        formName: `${stage.stageName || stageNameFromNumber(stage.stageNumber)} Rejection Analysis Form`,
        questions: rejectionQuestions
      },
      reworkForm: {
        formId: `stage-${stage.stageNumber}-rework-admin`,
        formName: `${stage.stageName || stageNameFromNumber(stage.stageNumber)} Rework Analysis Form`,
        questions: reworkQuestions
      },
      outcomes: [
        { status: 'accepted', routeStage: acceptedRouteForStage(stage, stageNumbers) },
        { status: 'rejected', optionType: stage.rejectionOptionType || '', options: splitList(stage.rejectionOptions) },
        { status: 'rework', optionType: stage.reworkOptionType || '', options: splitList(stage.reworkOptions) }
      ]
    }
    };
  });

  const existingConfig = await ManufacturingConfig.findOne({ productName });
  const workflowType = `${manufacturingStages.length}-step`;
  let workflowCreated = false;
  let configDoc;

  if (existingConfig) {
    existingConfig.workflowType = workflowType;
    existingConfig.stages = manufacturingStages;
    existingConfig.isActive = true;
    configDoc = await existingConfig.save();
  } else {
    workflowCreated = true;
    configDoc = await ManufacturingConfig.create({
      productName,
      workflowType,
      stages: manufacturingStages,
      isActive: true
    });
  }

  for (const stage of normalizedStages) {
    const rejectionQuestions = buildReviewQuestions({
      type: 'rejection',
      questionText: stage.rejectionQuestion,
      optionType: stage.rejectionOptionType,
      options: stage.rejectionOptions
    });
    const reworkQuestions = buildReviewQuestions({
      type: 'rework',
      questionText: stage.reworkQuestion,
      optionType: stage.reworkOptionType,
      options: stage.reworkOptions
    });
    const stageId = `${configDoc._id}-${stage.stageNumber}`;

    await StageReviewConfig.findOneAndUpdate(
      { stageId },
      {
        stageId,
        acceptedRouteStage: acceptedRouteForStage(stage, stageNumbers),
        reworkRouteStage: '',
        rejectionQuestionnaireEnabled: rejectionQuestions.length > 0,
        rejectionQuestions,
        reworkQuestionnaireEnabled: reworkQuestions.length > 0,
        reworkQuestions
      },
      { new: true, upsert: true }
    );

    await ensureDefects('reject', stage.rejectionOptions);
    await ensureDefects('rework', stage.reworkOptions);
  }

  return { created: workflowCreated };
};

const createProductQRCode = async (product) => {
  if (!product?.withQRCode) return null;
  const code = product.code || product.productName;
  return QRCode.create({
    code,
    batchNo: code,
    quantity: Number(product.numberOfItems || 0),
    currentStage: 1,
    status: 'generated'
  });
};

// @desc    Create new product (Admin only)
// @route   POST /api/products
exports.createProduct = async (req, res) => {
  try {
    const {
      productName,
      code,
      rootCode,
      withQRCode,
      createQRCode,
      brandId,
      modelId,
      brandName,
      model,
      category,
      subcategory,
      stockQuantity,
      numberOfItems,
      minStockLevel,
      basePrice,
      sellingPrice
    } = req.body;

    if (!productName) {
      return res.status(400).json({ message: 'productName is required' });
    }

    const requestedCode = normalizeCode(code || rootCode);

    // Ensure uniqueness even after deletion
    if (requestedCode) {
      const existingProduct = await Product.findOne({
        code: requestedCode
      });
      if (existingProduct) {
        return res.status(400).json({ message: 'Code already exists' });
      }
    }

    const resolved = brandId && modelId
      ? await resolveBrandModelStrings({ brandId, modelId, brandName, model })
      : await ensureBrandAndModel({ brandName, model });
    const resolvedCode = requestedCode || await generateCode();

    const product = new Product({
      productName,
      code: resolvedCode,
      category,
      subcategory,
      numberOfItems: Number(numberOfItems || stockQuantity || 0),
      stockQuantity: stockQuantity || numberOfItems || 0,
      minStockLevel: minStockLevel || 5,
      basePrice,
      sellingPrice,
      brandName: resolved.brandName,
      model: resolved.model,
      withQRCode: Boolean(withQRCode ?? createQRCode)
    });

    await product.save();
    await syncStageOneInputQuantity(product);
    await createProductQRCode(product);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update product (Admin only)
// @route   PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const {
      productName,
      code,
      rootCode,
      withQRCode,
      brandId,
      modelId,
      category,
      subcategory,
      stockQuantity,
      numberOfItems,
      minStockLevel,
      basePrice,
      sellingPrice
    } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const requestedCode = normalizeCode(code || rootCode);

    if (requestedCode && requestedCode !== product.code) {
      const existingProduct = await Product.findOne({
        _id: { $ne: product._id },
        code: requestedCode
      });
      if (existingProduct) {
        return res.status(400).json({ message: 'Code already exists' });
      }
    }

    if (productName) product.productName = productName;
    if (requestedCode) {
      product.code = requestedCode;
    }
    if (category) product.category = category;
    if (subcategory !== undefined) product.subcategory = subcategory;
    if (numberOfItems !== undefined) product.numberOfItems = Number(numberOfItems || 0);
    if (stockQuantity !== undefined) product.stockQuantity = stockQuantity;
    if (withQRCode !== undefined) product.withQRCode = Boolean(withQRCode);
    if (minStockLevel !== undefined) product.minStockLevel = minStockLevel;
    if (basePrice !== undefined) product.basePrice = basePrice;
    if (sellingPrice !== undefined) product.sellingPrice = sellingPrice;

    // Update brand/model only if IDs provided
    if (brandId && modelId) {
      const resolved = await resolveBrandModelStrings({ brandId, modelId });
      product.brandName = resolved.brandName;
      product.model = resolved.model;
    }

    await product.save();
    await syncStageOneInputQuantity(product);
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.bulkUploadProducts = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!rows.length) return res.status(400).json({ message: 'No products provided' });

    const result = { created: 0, updated: 0, qrCreated: 0, workflowCreated: 0, workflowUpdated: 0, errors: [] };

    for (const [index, row] of rows.entries()) {
      try {
        const productName = row.productName || row.name || row.description;
        if (!productName) throw new Error('productName is required');

        const code = normalizeCode(row.code || row.rootCode) || await generateCode();
        const rawQuantity = row.numberOfItems || row.items || row.quantity || row.stockQuantity;
        const parsedQuantity = Number(rawQuantity || 0);
        const numberOfItems = Number.isFinite(parsedQuantity) && parsedQuantity > 0
          ? parsedQuantity
          : (Array.isArray(row.workflowStages) && row.workflowStages.length ? 1 : 0);
        const withQRCode = toBoolean(row.withQRCode ?? row.withQR);
        const resolved = await ensureBrandAndModel({ brandName: row.brandName || row.brand, model: row.model });
        const resolvedCategory = await ensureCategoryAndSubcategory({
          categoryName: row.categoryName || row.category,
          subcategoryName: row.subcategoryName || row.subcategory
        });

        await ensureDefects('reject', row.rejectDefects || row.rejectionDefects || row.defectRejectDetails);
        await ensureDefects('rework', row.reworkDefects || row.defectReworkDetails);

        let product = await Product.findOne({
          $or: [
            { code },
            { productName }
          ]
        });
        const payload = {
          productName,
          code,
          description: row.description || productName,
          numberOfItems,
          stockQuantity: numberOfItems,
          brandName: resolved.brandName,
          model: resolved.model,
          ...(resolvedCategory.category ? { category: resolvedCategory.category } : {}),
          ...(resolvedCategory.subcategory ? { subcategory: resolvedCategory.subcategory } : {}),
          withQRCode
        };

        if (product) {
          Object.assign(product, payload);
          await product.save();
          result.updated += 1;
        } else {
          product = await Product.create(payload);
          result.created += 1;
        }

        await syncStageOneInputQuantity(product);
        const workflowSync = await syncWorkflowTemplate({
          productName,
          code: product.code,
          workflowStages: row.workflowStages
        });

        if (workflowSync) {
          if (workflowSync.created) result.workflowCreated += 1;
          else result.workflowUpdated += 1;
        }

        if (withQRCode) {
          const existingQr = await QRCode.findOne({ code });
          if (!existingQr) {
            await createProductQRCode(product);
            result.qrCreated += 1;
          }
        }
      } catch (error) {
        result.errors.push({ row: index + 2, error: error.message });
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete product (Admin only)
// @route   DELETE /api/products/:id
exports.deleteProduct = async (req, res) => {
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

// @desc    Get all low stock products
// @route   GET /api/products/low-stock/all
exports.getLowStockProducts = async (req, res) => {
  try {
    const products = await Product.find({
      $expr: { $lte: ['$stockQuantity', '$minStockLevel'] }
    })
      .populate('category', 'name')
      .populate('subcategory', 'name');
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get all categories
// @route   GET /api/products/categories/all
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create category (Admin only)
// @route   POST /api/products/categories
exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const category = new Category({ name, description });
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update category (Admin only)
// @route   PUT /api/products/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, description, isActive },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete category (Admin only)
// @route   DELETE /api/products/categories/:id
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get all subcategories or by category
// @route   GET /api/products/subcategories/all
exports.getSubcategories = async (req, res) => {
  try {
    const { category } = req.query;
    let query = { isActive: true };
    if (category) {
      query.category = category;
    }
    const subcategories = await Subcategory.find(query).select('name description isActive category');
    res.json(subcategories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create subcategory (Admin only)
// @route   POST /api/products/subcategories
exports.createSubcategory = async (req, res) => {
  try {
    const { name, category, description } = req.body;

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const subcategory = new Subcategory({ name, category, description });
    await subcategory.save();
    res.status(201).json(subcategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Update subcategory (Admin only)
// @route   PUT /api/products/subcategories/:id
exports.updateSubcategory = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    const subcategory = await Subcategory.findByIdAndUpdate(
      req.params.id,
      { name, description, isActive },
      { new: true }
    );
    if (!subcategory) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.json(subcategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Delete subcategory (Admin only)
// @route   DELETE /api/products/subcategories/:id
exports.deleteSubcategory = async (req, res) => {
  try {
    const subcategory = await Subcategory.findByIdAndDelete(req.params.id);
    if (!subcategory) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.json({ message: 'Subcategory deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get product analytics (sold count, dates, customers, interest)
// @route   GET /api/products/:id/analytics
exports.getProductAnalytics = async (req, res) => {
  try {
    const ObjectId = mongoose.Types.ObjectId;
    const productId = req.params.id;
    const product = await Product.findById(productId)
      .populate('category', 'name')
      .populate('subcategory', 'name');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const totalSoldResult = await Invoice.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.productId': new ObjectId(productId), status: 'completed' } },
      { $group: { _id: null, totalSold: { $sum: '$items.quantity' } } }
    ]);
    const totalSold = totalSoldResult[0]?.totalSold || 0;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const salesHistory = await Invoice.aggregate([
      { $unwind: '$items' },
      {
        $match: {
          'items.productId': new ObjectId(productId),
          status: 'completed',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const uniqueCustomers = await Invoice.distinct('customerName', {
      items: { $elemMatch: { productId: new ObjectId(productId) } },
      status: 'completed'
    });

    const totalRevenueResult = await Invoice.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.productId': new ObjectId(productId), status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: '$items.total' } } }
    ]);
    const totalRevenue = totalRevenueResult[0]?.totalRevenue || 0;

    const recentActivity = await Invoice.find({
      items: { $elemMatch: { productId: new ObjectId(productId) } },
      status: 'completed'
    })
      .select('createdAt invoiceNumber customerName totalAmount')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      product,
      analytics: {
        totalSold,
        totalRevenue,
        customersBought: uniqueCustomers.length,
        customerInterest: uniqueCustomers.length > 0
          ? Math.round((uniqueCustomers.length / 10) * 100) || 0
          : 0,
        firstStockDate: product.createdAt,
        lastActivity: product.updatedAt,
        salesHistory: salesHistory.map(h => ({ date: h._id, sold: h.sold, revenue: h.revenue })),
        recentActivity
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
};




