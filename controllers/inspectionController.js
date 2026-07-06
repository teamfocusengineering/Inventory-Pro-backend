const InspectionFormResponse = require('../models/InspectionFormResponse');
const InspectionScanLog = require('../models/InspectionScanLog');
const QRCode = require('../models/QRCode');
const Product = require('../models/Product');
const ProductItem = require('../models/ProductItem');
const StageMovementLog = require('../models/StageMovementLog');
const ProcessingStage = require('../models/ProcessingStage');
const ProductStage = require('../models/ProductStage');
const ManufacturingConfig = require('../models/ManufacturingConfig');
const Role = require('../models/Role');
const mongoose = require('mongoose');
const {
  buildProductPayload,
  ensureProcessingStage,
  getStageByNumber,
  resolveProductContext
} = require('../services/inspectionService');
const {
  getInspectionClassification,
  normalizeReportText,
  reportIdFor,
  toKey
} = require('../utils/reportClassification');

const todayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getEmployeeName = (user) => user?.name || user?.username || user?.email || 'Employee';

const normalizeInspectionResult = (value) => String(value || '').trim().toUpperCase();
const normalizeMovementType = (value) => String(value || 'NONE').trim().toUpperCase();
const toCount = (value) => Math.max(0, Number(value) || 0);
const summarizeResponses = (responses = []) =>
  responses
    .filter((item) => item?.answer !== undefined && item?.answer !== null && item?.answer !== '')
    .map((item) => `${item.question || item.questionId}: ${Array.isArray(item.answer) ? item.answer.join(', ') : item.answer}`)
    .join('; ');
const stageLabel = (stageNumber, stage) => stage?.stageName || `Stage ${stageNumber}`;

const getProductWithCategoryForResponse = async (response, qrCode) => {
  const codeCandidates = [
    qrCode?.code,
    response?.code,
    response?.productId
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const productName = String(response?.productName || '').trim();

  if (!codeCandidates.length && !productName) return null;

  const directProduct = await Product.findOne({
    $or: [
      ...codeCandidates.map((code) => ({ code })),
      ...(productName ? [{ productName }] : [])
    ]
  })
    .populate('category', 'name')
    .lean();
  if (directProduct) return directProduct;

  const item = await ProductItem.findOne({ code: { $in: codeCandidates } }).lean();
  if (!item) return null;

  if (item.rootProductId) {
    const productById = await Product.findById(item.rootProductId)
      .populate('category', 'name')
      .lean();
    if (productById) return productById;
  }

  if (item.rootCode) {
    return Product.findOne({ code: item.rootCode })
      .populate('category', 'name')
      .lean();
  }

  return null;
};

const employeeIdMatch = (employeeId) => {
  const ids = [employeeId].filter(Boolean);
  const asString = employeeId ? String(employeeId) : '';
  if (asString && mongoose.Types.ObjectId.isValid(asString)) {
    ids.push(new mongoose.Types.ObjectId(asString));
  }

  return { $or: ids.map((id) => ({ employee: id })) };
};

const validateEmployeeStageAccess = ({ employee, currentStage, stages = [] }) => {
  if (employee?.role !== 'employee') {
    return {
      allowed: true,
      response: {
        status: 'success',
        action: 'OPEN_DETAILS_PAGE',
        message: `Access granted. Loading product details for stage ${stageLabel(currentStage?.stageNumber, currentStage)}.`
      }
    };
  }

  const assignedStageNumbers = Array.isArray(employee.assignedStages) && employee.assignedStages.length
    ? employee.assignedStages.map((stage) => Number(stage.stageNumber || stage)).filter(Number.isFinite)
    : [Number(employee.manufacturingLevel || 1)];
  const productStage = Number(currentStage?.stageNumber || 1);
  const assignedStageName = assignedStageNumbers
    .map((stageNumber) => stageLabel(stageNumber, stages.find((stage) => Number(stage.stageNumber) === stageNumber)))
    .join(', ');
  const productStageName = stageLabel(productStage, currentStage);

  if (assignedStageNumbers.includes(productStage)) {
    return {
      allowed: true,
      response: {
        status: 'success',
        action: 'OPEN_DETAILS_PAGE',
        message: `Access granted. Loading product details for stage ${productStageName}.`
      }
    };
  }

  return {
    allowed: false,
    response: {
      status: 'error',
      action: 'SHOW_ALERT',
      message: `Access Denied. The product is still in ${productStageName} and cannot be processed at your current stage (${assignedStageName}).`
    }
  };
};

const canEmployeeProcessStage = (employee, stageNumber) => {
  if (employee?.role !== 'employee') return true;
  const assignedStageNumbers = Array.isArray(employee.assignedStages) && employee.assignedStages.length
    ? employee.assignedStages.map((stage) => Number(stage.stageNumber || stage)).filter(Number.isFinite)
    : [Number(employee.manufacturingLevel || 1)];
  return assignedStageNumbers.includes(Number(stageNumber));
};

const getEmployeeRolePermission = async (employee, productId) => {
  if (employee?.role !== 'employee') return null;
  if (!employee.assignedRole || !productId) return { allowed: false, stageNumbers: [] };

  const role = await Role.findById(employee.assignedRole).lean();
  if (!role) return { allowed: false, stageNumbers: [] };

  const productIdString = String(productId);
  const products = (role.permissions || []).flatMap((category) =>
    category.subcategories?.length
      ? category.subcategories.flatMap((subcategory) => subcategory.products || [])
      : category.products || []
  );
  const permission = products.find((product) => String(product.productId) === productIdString);
  if (!permission) return { allowed: false, stageNumbers: [] };

  return {
    allowed: true,
    stageNumbers: (permission.stages || []).map((stage) => Number(stage.stageNumber)).filter(Number.isFinite)
  };
};

const getEmployeeAssignedProductIds = async (employee) => {
  if (employee?.role !== 'employee') return null;
  if (!employee.assignedRole) return [];
  const role = await Role.findById(employee.assignedRole).select('products permissions').lean();
  if (!role) return [];

  const productIds = new Set((role.products || []).map(String));
  (role.permissions || []).forEach((category) => {
    (category.subcategories || []).forEach((subcategory) => {
      (subcategory.products || []).forEach((product) => {
        if (product.productId) productIds.add(String(product.productId));
      });
    });
  });

  return Array.from(productIds);
};

const getCurrentQrForCodes = async (codes = []) => {
  const normalizedCodes = codes.filter(Boolean);
  if (!normalizedCodes.length) return null;

  return QRCode.findOne({ code: { $in: normalizedCodes } })
    .sort({ currentStage: -1, updatedAt: -1 })
    .lean();
};

const getAvailableCountForStage = async (codes = [], stageNumber) => {
  const normalizedCodes = codes.filter(Boolean);
  const normalizedStageNumber = Number(stageNumber);
  if (!normalizedCodes.length || !Number.isFinite(normalizedStageNumber)) return 0;

  const productStages = await ProductStage.find({
    code: { $in: normalizedCodes },
    stageNumber: normalizedStageNumber
  }).lean();

  const productStageCount = productStages.reduce((sum, row) => {
    const pending = Number(row.pendingCount);
    if (Number.isFinite(pending)) return sum + Math.max(pending, 0);
    const available = Number(row.availableQuantity || 0);
    const processed = Number(row.acceptedCount || 0)
      + Number(row.rejectedCount || 0)
      + Number(row.reworkCount || 0);
    return sum + Math.max(available - processed, 0);
  }, 0);
  if (productStages.length) return productStageCount;

  const qrCount = await QRCode.countDocuments({
    code: { $in: normalizedCodes },
    currentStage: normalizedStageNumber
  });
  if (qrCount > 0) return qrCount;

  const processingStages = await ProcessingStage.find({
    code: { $in: normalizedCodes },
    stageNumber: normalizedStageNumber,
    $or: [{ qrId: { $exists: false } }, { qrId: null }]
  }).lean();

  return processingStages.reduce((sum, row) => {
    const input = Number(row.inputQuantity || 0);
    const processed = Number(row.acceptedQuantity || 0)
      + Number(row.rejectedQuantity || 0)
      + Number(row.reworkQuantity || 0);
    return sum + Math.max(input - processed, 0);
  }, 0);
};

const buildEmployeeStageRows = async ({ codes = [], stages = [], employee, productId, currentStageNumber }) => {
  const normalizedCodes = codes.filter(Boolean);
  const rolePermission = await getEmployeeRolePermission(employee, productId);
  return Promise.all(
    stages.map(async (stage) => {
      const isCurrent = Number(stage.stageNumber) === Number(currentStageNumber);
      const isAssigned = employee?.role !== 'employee'
        || (rolePermission?.allowed && rolePermission.stageNumbers.includes(Number(stage.stageNumber)));
      const availableCount = normalizedCodes.length
        ? await getAvailableCountForStage(normalizedCodes, stage.stageNumber)
        : 0;
      const isOpenIntakeStage = Number(stage.stageNumber) === 1;
      return {
        stageNumber: stage.stageNumber,
        stageName: stage.stageName,
        productionLine: stage.productionLine || '',
        reportType: stage.reportType || '',
        processKey: stage.processKey || '',
        processName: stage.processName || stage.stageName || '',
        partKey: stage.partKey || '',
        partName: stage.partName || '',
        stageType: stage.stageType,
        isCurrent,
        isAssigned,
        selectable: isAssigned && (isOpenIntakeStage || availableCount > 0),
        availableCount
      };
    })
  );
};

const buildAnalysisForms = (stage, formType) => {
  const formDefinition = formType === 'rejection' ? stage?.reviewForm?.rejectionForm : stage?.reviewForm?.reworkForm;
  const questions = formDefinition?.questions || formDefinition?.outcomes || [];
  if (!questions.length) return [];

  return [{
    formId: formDefinition.formId || `stage-${stage.stageNumber}-${formType}`,
    formName: formDefinition.formName || `${stage.stageName} ${formType === 'rejection' ? 'Rejection' : 'Rework'} Analysis`,
    questions
  }];
};

exports.scanQRCode = async (req, res) => {
  try {
    const { qrId } = req.body;
    if (!qrId) return res.status(400).json({ message: 'qrId is required' });

    const qrCode = await QRCode.findOne({ qrId });
    if (!qrCode) return res.status(404).json({ message: 'QR code not found' });

    const payload = await buildProductPayload(qrCode);
    const access = validateEmployeeStageAccess({ employee: req.user, currentStage: payload.currentStage, stages: payload.stages });

    if (!access.allowed) {
      return res.status(403).json(access.response);
    }

    await InspectionScanLog.create({
      qrCode: qrCode._id,
      qrId: qrCode.qrId,
      itemId: qrCode.qrId,
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: payload.productInfo.productName,
      code: qrCode.code,
      partDescription: payload.productInfo.partDescription,
      stageNumber: payload.currentStage.stageNumber,
      stageName: payload.currentStage.stageName,
      status: 'SCANNED',
      actionTaken: 'SCAN',
      location: payload.currentStage.stageName
    });

    res.json({
      ...access.response,
      ...payload
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductForEmployee = async (req, res) => {
  try {
    const { code } = req.params;
    const qrCode = await QRCode.findOne({
      $or: [
        { qrId: code },
        { code },
        { batchNo: code }
      ]
    }).sort({ updatedAt: -1 });

    if (!qrCode) return res.status(404).json({ message: 'Product item not found' });

    const payload = await buildProductPayload(qrCode);
    const rolePermission = await getEmployeeRolePermission(req.user, payload.product?._id);
    if (req.user?.role === 'employee' && !rolePermission?.allowed) {
      return res.status(403).json({ message: 'This product is not assigned to your role' });
    }
    const access = validateEmployeeStageAccess({ employee: req.user, currentStage: payload.currentStage, stages: payload.stages });

    if (!access.allowed) {
      return res.status(403).json(access.response);
    }

    await InspectionScanLog.create({
      qrCode: qrCode._id,
      qrId: qrCode.qrId,
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: payload.productInfo.productName,
      code: qrCode.code,
      batchNo: qrCode.batchNo,
      itemId: qrCode.qrId,
      partDescription: payload.productInfo.partDescription,
      stageNumber: payload.currentStage.stageNumber,
      stageName: payload.currentStage.stageName,
      status: 'SCANNED',
      actionTaken: 'LOOKUP',
      location: payload.currentStage.stageName
    });

    res.json({
      ...access.response,
      product: {
        ...payload.productInfo,
        batchNo: qrCode.batchNo || '',
        itemId: qrCode.qrId,
        totalIdealItems: await QRCode.countDocuments({ code: qrCode.code }),
        createdDate: qrCode.createdAt,
        nextStage: payload.stages.find((stage) => Number(stage.stageNumber) === Number(payload.currentStage.stageNumber) + 1)?.stageName || 'Final Stage'
      },
      stage: payload.currentStage,
      stages: payload.stages,
      forms: payload.forms,
      itemState: payload.itemState,
      history: await InspectionFormResponse.find({ qrId: qrCode.qrId }).sort({ submittedAt: -1 }).limit(10),
      qrCode: payload.qrCode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.searchProductsForEmployee = async (req, res) => {
  try {
    const { q = '' } = req.query;
    const term = String(q).trim();
    const assignedProductIds = await getEmployeeAssignedProductIds(req.user);
    if (req.user?.role === 'employee' && assignedProductIds.length === 0) return res.json([]);

    // If employee searches by product name, we must return product-level entry
    // and show overall total QR count under that product.
    const productFilter = assignedProductIds === null ? {} : { _id: { $in: assignedProductIds } };
    const productRows = await Product.find(
      term
        ? { ...productFilter,
            $or: [
              { productName: { $regex: term, $options: 'i' } },
              { code: { $regex: term, $options: 'i' } }
            ]
          }
        : productFilter
    )
      .limit(50)
      .lean();

    // Requirement: employee portal dropdown/list should show each product ONCE (union by productName),
    // even if multiple QR codes exist for the same code/productName.
    // We therefore always collapse to a single row per productName when term matches productName.
    const matchedByProductName = term
      ? productRows.filter((p) => String(p.productName || '').toLowerCase().includes(term.toLowerCase()))
      : productRows;

    if (matchedByProductName.length) {
      const uniqueProductNames = Array.from(new Set(matchedByProductName.map((p) => p.productName).filter(Boolean)));

      const rows = [];
      for (const productName of uniqueProductNames) {
        const codes = matchedByProductName
          .filter((p) => p.productName === productName)
          .map((p) => p.code)
          .filter(Boolean);

        const latestQrRows = codes.length
          ? await QRCode.find({ code: { $in: codes } }).sort({ updatedAt: -1 }).limit(1).lean()
          : null;

        const latestQr = latestQrRows?.[0];
        const { stages } = await resolveProductContext(codes[0]);
        const stageCounts = await Promise.all(
          (stages || []).map(async (stage) => ({
            stageNumber: Number(stage.stageNumber),
            count: await getAvailableCountForStage(codes, stage.stageNumber)
          }))
        );
        const permission = await getEmployeeRolePermission(req.user, matchedByProductName.find((p) => p.productName === productName)?._id);
        const availableCount = permission?.stageNumbers?.length
          ? stageCounts.filter((item) => permission.stageNumbers.includes(item.stageNumber)).reduce((sum, item) => sum + item.count, 0)
          : stageCounts.reduce((sum, item) => sum + item.count, 0);
        const firstAvailableStage = stageCounts.find((item) => item.count > 0);

        rows.push({
          productId: matchedByProductName.find((p) => p.productName === productName)?._id || null,
          productName,
          code: codes[0] || '',
          batchNo: '',
          availableCount,
          currentStage: latestQr?.currentStage || firstAvailableStage?.stageNumber || stages?.[0]?.stageNumber || 1
        });
      }

      const normalizedTerm = term.toLowerCase();
      rows.sort((a, b) => {
        const aName = String(a.productName || '').toLowerCase();
        const bName = String(b.productName || '').toLowerCase();
        const aCode = String(a.code || '').toLowerCase();
        const bCode = String(b.code || '').toLowerCase();
        const score = (name, code) => {
          if (name === normalizedTerm || code === normalizedTerm) return 0;
          if (name.startsWith(normalizedTerm) || code.startsWith(normalizedTerm)) return 1;
          return 2;
        };
        return score(aName, aCode) - score(bName, bCode) || aName.localeCompare(bName);
      });

      return res.json(rows.slice(0, 20));
    }

    // No productName matches: fall back to empty result.
    return res.json([]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBatchProductForEmployee = async (req, res) => {
  try {
    const { key } = req.params;
    const assignedProductIds = await getEmployeeAssignedProductIds(req.user);
    const productScope = assignedProductIds === null ? {} : { _id: { $in: assignedProductIds } };

    const productMatch = await Product.findOne({
      ...productScope,
      $or: [
        { productName: key },
        {
          productName: {
            $regex: `^${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            $options: 'i'
          }
        },
        { code: key }
      ]
    });

    // If matched by productName, compute total QR count under that product name.
    if (productMatch?.productName) {
      const rolePermission = await getEmployeeRolePermission(req.user, productMatch._id);
      if (req.user?.role === 'employee' && !rolePermission?.allowed) {
        return res.status(403).json({ message: 'This product is not assigned to your role' });
      }
      const matchedProducts = await Product.find({ productName: productMatch.productName, ...productScope }).select('code').lean();
      const codes = matchedProducts.map((p) => p.code).filter(Boolean);

      const currentQr = await getCurrentQrForCodes(codes);

      const primaryCode = currentQr?.code || codes[0] || productMatch.code;
      const { config, stages } = await resolveProductContext(primaryCode);
      const preliminaryStageRows = await buildEmployeeStageRows({ codes, stages, employee: req.user, productId: productMatch._id });
      const firstAvailableStage = preliminaryStageRows.find((stage) => Number(stage.availableCount || 0) > 0);
      const currentStageNumber = currentQr?.currentStage > 0
        ? currentQr.currentStage
        : firstAvailableStage?.stageNumber || stages[0]?.stageNumber || 1;
      const currentStage = getStageByNumber(stages, currentStageNumber);
      const stageRows = await buildEmployeeStageRows({ codes, stages, employee: req.user, productId: productMatch._id, currentStageNumber });

      if (req.user?.role === 'employee' && !stageRows.some((stage) => stage.selectable)) {
        return res.status(403).json({ message: `This product is currently at ${currentStage.stageName}, which is not assigned to your role` });
      }

      const availableCount = await getAvailableCountForStage(codes, currentStageNumber);

      await InspectionScanLog.create({
        qrCode: currentQr?._id,
        qrId: currentQr?.qrId || primaryCode || productMatch.productName,
        itemId: currentQr?.qrId || '',
        employee: req.user._id,
        employeeName: getEmployeeName(req.user),
        productName: productMatch.productName,
        code: primaryCode,
        batchNo: '',
        partDescription: productMatch.description || productMatch.productName || '',
        stageNumber: currentStage.stageNumber,
        stageName: currentStage.stageName,
        status: 'SCANNED',
        actionTaken: 'LOOKUP',
        location: currentStage.stageName
      });

      res.json({
        product: {
          productId: productMatch._id,
          productName: productMatch.productName,
          code: primaryCode,
          batchNo: '',
          partDescription: productMatch.description || productMatch.productName || '',
          availableCount,
          createdDate: productMatch.createdAt || currentQr?.createdAt || null,
          currentStage: currentStage.stageName,
          currentStageNumber
        },
        stage: currentStage,
        stages: stageRows,
        forms: (() => {
          const questions = currentStage?.reviewForm?.questions || currentStage?.reviewForm?.outcomes || [];
          return questions.length
            ? [
                {
                  formId: currentStage.reviewForm.formId || `stage-${currentStage.stageNumber}-inspection`,
                  formName: currentStage.reviewForm.formName || `${currentStage.stageName} Inspection`,
                  questions
                }
              ]
            : [];
        })(),
        rejectionForms: buildAnalysisForms(currentStage, 'rejection'),
        reworkForms: buildAnalysisForms(currentStage, 'rework'),
        configId: config?._id
      });
      return;
    }

    // Fallback: key matched by code/batch.
    const qrCode = await QRCode.findOne({
      $or: [
        { code: key },
        { batchNo: key },
        ...(productMatch?.code ? [{ code: productMatch.code }] : [])
      ]
    }).sort({ updatedAt: -1 });

    if (!qrCode && !productMatch) return res.status(404).json({ message: 'Product not found' });

    const code = qrCode?.code || productMatch.code;
    const { product, config, stages } = await resolveProductContext(code);
    const resolvedProduct = product || productMatch;
    const rolePermission = await getEmployeeRolePermission(req.user, resolvedProduct?._id);
    if (req.user?.role === 'employee' && !rolePermission?.allowed) {
      return res.status(403).json({ message: 'This product is not assigned to your role' });
    }
    const currentStageNumber = qrCode?.currentStage > 0 ? qrCode.currentStage : stages[0]?.stageNumber || 1;
    const currentStage = getStageByNumber(stages, currentStageNumber);
    const availableCount = await getAvailableCountForStage([code], currentStageNumber) ||
      qrCode?.quantity ||
      resolvedProduct?.quantity ||
      resolvedProduct?.stock ||
      0;

    await InspectionScanLog.create({
      qrCode: qrCode?._id,
      qrId: qrCode?.qrId || code,
      itemId: qrCode?.qrId || '',
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: resolvedProduct?.productName || code,
      code,
      batchNo: qrCode?.batchNo || '',
      partDescription: resolvedProduct?.description || resolvedProduct?.productName || '',
      stageNumber: currentStage.stageNumber,
      stageName: currentStage.stageName,
      status: 'SCANNED',
      actionTaken: 'LOOKUP',
      location: currentStage.stageName
    });

    res.json({
      product: {
        productId: resolvedProduct?._id || qrCode?._id,
        productName: resolvedProduct?.productName || code,
        code,
        batchNo: qrCode?.batchNo || '',
        partDescription: resolvedProduct?.description || resolvedProduct?.productName || '',
        availableCount,
        createdDate: resolvedProduct?.createdAt || qrCode?.createdAt || null,
        currentStage: currentStage.stageName,
        currentStageNumber
      },
      stage: currentStage,
      stages: await buildEmployeeStageRows({ codes: [code], stages, employee: req.user, productId: resolvedProduct?._id, currentStageNumber }),
      forms: (() => {
        const questions = currentStage?.reviewForm?.questions || currentStage?.reviewForm?.outcomes || [];
        return questions.length
          ? [
              {
                formId: currentStage.reviewForm.formId || `stage-${currentStage.stageNumber}-inspection`,
                formName: currentStage.reviewForm.formName || `${currentStage.stageName} Inspection`,
                questions
              }
            ]
          : [];
      })(),
      rejectionForms: buildAnalysisForms(currentStage, 'rejection'),
      reworkForms: buildAnalysisForms(currentStage, 'rework'),
      configId: config?._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.submitBatchInspectionResponse = async (req, res) => {
  try {
    const {
      productId = '',
      code,
      batchNo = '',
      productName = '',
      productionLine = '',
      reportType = '',
      processKey = '',
      processName = '',
      partKey = '',
      partName = '',
      stageId,
      stageName = '',
      acceptedCount,
      rejectedCount,
      reworkCount,
      inspectionFormResponses = [],
      rejectionFormResponses = [],
      reworkFormResponses = [],
      remarks = ''
    } = req.body;

    if (!code) return res.status(400).json({ message: 'code is required' });
    const stageNumber = Number(stageId);
    if (!Number.isFinite(stageNumber)) return res.status(400).json({ message: 'stageId is required' });
    if (!canEmployeeProcessStage(req.user, stageNumber)) {
      return res.status(403).json({ message: 'You are not assigned to this manufacturing stage' });
    }

    // Accepted: use the submitted UI count as-is.
    // Rejected/Rework: derive counts from selected options in the corresponding analysis forms.
    // This matches the task requirement: counts must be computed based on the options selected,
    // and if multiple choice exists under each option, we aggregate it into the overall reject count.

    const deriveChoiceCountsFromResponses = (responses = []) => {
      // Expected shape from QuestionCountGrid:
      // - Selection response: { questionId, question, type: 'checkbox'|'multiSelect'|'radio'..., answer: string|string[] }
      // - Count response per option: { questionId, question, type: 'count', optionKey, answer: <number> }
      //
      // Requirement: rejected/rework totals must be calculated from numeric counts entered
      // for the selected options, not just number of selections.

      const normalizeAnswerValues = (val) => {
        if (Array.isArray(val)) return val.map(String).filter(Boolean);
        if (val === null || val === undefined) return [];
        const s = String(val).trim();
        return s ? [s] : [];
      };

      let overall = 0;
      const perQuestion = {};

      // Build: for each question, track which options were selected and their entered counts.
      const selectedByQuestion = {};
      const countsByQuestionOption = {};
      const freeFormCountsByQuestion = {};
      const missingReasonDetails = [];

      for (const r of responses || []) {
        const qKey = String(r?.questionId || r?.question || 'unknown');
        const type = String(r?.type || 'text').toLowerCase();

        if (type === 'count') {
          const optionKey = String(r?.optionKey || '').trim();
          if (!optionKey) continue;
          const countVal = Math.max(0, Number(r?.answer) || 0);
          if (optionKey === '__response__') {
            if (countVal > 0 && !String(r?.defectDetail || r?.question || '').trim()) {
              missingReasonDetails.push({
                question: r?.question || qKey,
                optionKey
              });
            }
            freeFormCountsByQuestion[qKey] = (freeFormCountsByQuestion[qKey] || 0) + countVal;
            continue;
          }
          if (!countsByQuestionOption[qKey]) countsByQuestionOption[qKey] = {};
          countsByQuestionOption[qKey][optionKey] = {
            count: countVal,
            defectDetail: String(r?.defectDetail || r?.defectType || r?.question || '').trim(),
            assemblyProcess: String(r?.assemblyProcess || '').trim(),
            defectType: String(r?.defectType || r?.defectDetail || r?.question || '').trim(),
            subQuestion: String(r?.subQuestion || '').trim(),
            subOption: String(r?.subOption || '').trim()
          };
          continue;
        }

        // Selection-bearing responses
        const selectedVals = normalizeAnswerValues(r?.answer);
        if (!selectedByQuestion[qKey]) selectedByQuestion[qKey] = new Set();
        for (const v of selectedVals) selectedByQuestion[qKey].add(v);
      }

      // Sum counts only for selected options.
      for (const [qKey, selectedSet] of Object.entries(selectedByQuestion)) {
        let qSum = 0;
        const countsForQ = countsByQuestionOption[qKey] || {};
        for (const opt of selectedSet) {
          const countEntry = countsForQ[opt] || {};
          const c = Math.max(0, Number(countEntry.count) || 0);
          if (c > 0 && !countEntry.defectDetail) {
            missingReasonDetails.push({
              question: qKey,
              optionKey: opt
            });
          }
          qSum += c;
        }
        overall += qSum;
        perQuestion[qKey] = qSum;
      }

      for (const [qKey, count] of Object.entries(freeFormCountsByQuestion)) {
        const c = Math.max(0, Number(count) || 0);
        overall += c;
        perQuestion[qKey] = (perQuestion[qKey] || 0) + c;
      }

      return { overall, perQuestion, missingReasonDetails };
    };

    const derivedRejected = deriveChoiceCountsFromResponses(rejectionFormResponses);
    const derivedRework = deriveChoiceCountsFromResponses(reworkFormResponses);

    const counts = {
      accepted: toCount(acceptedCount),
      rejected: derivedRejected.overall || toCount(rejectedCount),
      rework: derivedRework.overall || toCount(reworkCount)
    };

    if (derivedRejected.missingReasonDetails.length) {
      return res.status(400).json({ message: 'Enter a reject count for the selected reason details' });
    }
    if (derivedRework.missingReasonDetails.length) {
      return res.status(400).json({ message: 'Enter a rework count for the selected reason details' });
    }

    const total = counts.accepted + counts.rejected + counts.rework;


    // Log overall reject count (requirement) and per derived breakdown.
    console.log('[inspection submitBatchInspectionResponse] Derived counts =>', {
      accepted: counts.accepted,
      rejectedDerivedFromOptions: counts.rejected,
      reworkDerivedFromOptions: counts.rework,
      total,
      derivedRejectedByQuestion: derivedRejected.perQuestion,
      derivedReworkByQuestion: derivedRework.perQuestion
    });
    const qrCode = await QRCode.findOne({ code, ...(batchNo ? { batchNo } : {}) }).sort({ updatedAt: -1 });
    const { product, stages } = await resolveProductContext(code);
    const resolvedProductId = product?._id || productId;
    const isOpenIntakeStage = Number(stageNumber) === 1;
    const stageAvailableCount = await getAvailableCountForStage([code], stageNumber);
    const hasStageQueue = await ProductStage.exists({ productId: resolvedProductId, stageNumber });
    const availableCount = hasStageQueue ? stageAvailableCount : Number(qrCode?.quantity || 0);
    if (total <= 0) return res.status(400).json({ message: 'Enter at least one processed item' });
    if (!isOpenIntakeStage && total > availableCount) return res.status(400).json({ message: 'Quantity breakdown cannot exceed available item count' });
    const stage = getStageByNumber(stages, stageNumber);
    const reportClassification = getInspectionClassification({
      productionLine,
      reportType,
      processKey,
      processName,
      partKey,
      partName,
      productName: productName || product?.productName || code,
      code,
      partDescription: product?.description || product?.productName || '',
      stageName: stageName || stage?.stageName || `Stage ${stageNumber}`
    });

    // Update ProductStage counters based on submitted counts.
    // Keep QR logic only for trace/movement; ProductStage becomes source of truth for stage review stats.
    // NOTE: availableQuantity is expected to be initialized when ProductStage rows are created.
    // If not found, create it with sane defaults.
    // Ensure ProductStage row exists for this product+stage
    const productStage = await ProductStage.findOneAndUpdate(
      {
        productId: resolvedProductId,
        stageNumber
      },
      {
        $setOnInsert: {
          productId: resolvedProductId,

          code,
          stageNumber,
          stageName: stage?.stageName || `Stage ${stageNumber}`,
          availableQuantity: isOpenIntakeStage ? 0 : availableCount,
          acceptedCount: 0,
          rejectedCount: 0,
          reworkCount: 0,
          pendingCount: isOpenIntakeStage ? 0 : availableCount
        }
      },
      { new: true, upsert: true }
    );

    // Recalculate pending based on counters.
    const nextAccepted = Number(productStage.acceptedCount || 0) + counts.accepted;
    const nextRejected = Number(productStage.rejectedCount || 0) + counts.rejected;
    const nextRework = Number(productStage.reworkCount || 0) + counts.rework;
    // All submitted outcomes leave the active queue. Only accepted units move
    // forward; rejected and rework remain recorded in logs and stage statistics.
    const currentPending = Number.isFinite(Number(productStage.pendingCount))
      ? Number(productStage.pendingCount)
      : availableCount;
    const nextPending = isOpenIntakeStage
      ? 0
      : Math.max(currentPending - total, 0);
    const nextAvailableQuantity = isOpenIntakeStage
      ? Number(productStage.availableQuantity || 0) + total
      : Number(productStage.availableQuantity || availableCount || 0);

    await ProductStage.updateOne(
      {
        _id: productStage._id
      },
      {
        $set: {
          acceptedCount: nextAccepted,
          rejectedCount: nextRejected,
          reworkCount: nextRework,
          availableQuantity: nextAvailableQuantity,
          pendingCount: nextPending
        }
      }
    );

    await ProcessingStage.findOneAndUpdate(
      {
        code,
        stageNumber,
        $or: [{ qrId: { $exists: false } }, { qrId: null }]
      },
      {
        $set: {
          code,
          stageNumber,
          stageName: stage?.stageName || `Stage ${stageNumber}`,
          inputQuantity: nextAvailableQuantity,
          acceptedQuantity: nextAccepted,
          rejectedQuantity: nextRejected,
          reworkQuantity: nextRework,
          outputQuantity: nextAccepted,
          status: nextPending > 0 ? 'in_progress' : 'completed',
          operator: getEmployeeName(req.user)
        }
      },
      { new: true, upsert: true }
    );



    await InspectionScanLog.create({
      qrCode: qrCode?._id,
      qrId: qrCode?.qrId || `${code}-${batchNo || 'batch'}`,
      itemId: qrCode?.qrId || '',
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: productName || product?.productName || code,
      code,
      batchNo,
      partDescription: product?.description || product?.productName || '',
      ...reportClassification,
      stageNumber,
      stageName: stageName || stage?.stageName || `Stage ${stageNumber}`,
      status: counts.rejected > 0 ? 'REJECTED' : counts.rework > 0 ? 'REWORK' : 'ACCEPTED',
      actionTaken: 'BATCH_SUBMIT',
      remarks: String(remarks || '').trim(),
      location: stageName || stage?.stageName || `Stage ${stageNumber}`,
      metadata: {
        acceptedCount: counts.accepted,
        rejectedCount: counts.rejected,
        reworkCount: counts.rework
      }
    });

    const responseDoc = await InspectionFormResponse.create({

      qrCode: qrCode?._id,
      productId: resolvedProductId,

      qrId: qrCode?.qrId || `${code}-${batchNo || 'batch'}`,
      itemId: '',
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: productName || product?.productName || code,
      code,
      batchNo,
      partDescription: product?.description || product?.productName || '',
      ...reportClassification,
      stageNumber,
      stageName: stageName || stage?.stageName || `Stage ${stageNumber}`,
      formId: `stage-${stageNumber}`,
      formName: `${stageName || stage?.stageName || `Stage ${stageNumber}`} Inspection`,
      inspectionResult: counts.rejected > 0 ? 'REJECTED' : counts.rework > 0 ? 'REWORK' : 'ACCEPTED',
      acceptedCount: counts.accepted,
      rejectedCount: counts.rejected,
      reworkCount: counts.rework,
      responses: inspectionFormResponses,
      rejectionFormResponses,
      reworkFormResponses,
      remarks: String(remarks || '').trim(),
      movement: {
        type: 'NONE',
        fromStageNumber: stageNumber,
        fromStageName: stageName || stage?.stageName,
        toStageNumber: stageNumber,
        toStageName: stageName || stage?.stageName
      }
    });

    // Stage movement for batch:
    // - Use only accepted/rejected/rework counts (not QR generator "quantity" notion).
    // - Select exactly N QRCode documents currently at this stage and apply transitions.
    const currentStageIndex = stages.findIndex((s) => Number(s.stageNumber) === Number(stageNumber));
    const nextStage = currentStageIndex >= 0 ? stages[currentStageIndex + 1] : null;

    const candidateQrs = await QRCode.find({
      code,
      ...(batchNo ? { batchNo } : {}),
      currentStage: stageNumber
    })
      .sort({ createdAt: 1 });

    // ProductStage owns batch quantities. QR movement is only valid when the
    // product really has one QR document per physical unit.
    const hasUnitLevelQrs = candidateQrs.length >= total
      && candidateQrs.slice(0, total).every((item) => Number(item.quantity || 1) === 1);
    const qrsPool = hasUnitLevelQrs ? candidateQrs.slice(0, total) : [];

    const acceptedQrs = qrsPool.slice(0, counts.accepted);
    const rejectedQrs = qrsPool.slice(counts.accepted, counts.accepted + counts.rejected);
    const reworkQrs = qrsPool.slice(counts.accepted + counts.rejected, counts.accepted + counts.rejected + counts.rework);

    const operatorName = getEmployeeName(req.user);

    // Move accepted to next stage (if exists), else mark as accepted at current stage (final stage)
    if (counts.accepted > 0 && nextStage) {
      // Update unit-level QR codes when they exist. Batch quantities move via
      // ProductStage below and must not move an entire aggregate QR document.
      if (acceptedQrs.length) {
        await QRCode.updateMany(
          { _id: { $in: acceptedQrs.map((q) => q._id) } },
          { $set: { currentStage: nextStage.stageNumber, status: 'processing' } }
        );
      }

      // 2) Queue counters: accepted items are now *arrived for processing* in next stage,
      // but they should not be counted as 'accepted' at the next stage yet.
      await ProductStage.findOneAndUpdate(
        {
          productId: resolvedProductId,
          stageNumber: nextStage.stageNumber
        },
        {
          $setOnInsert: {
            productId: resolvedProductId,
            code,
           stageNumber: nextStage.stageNumber,
           stageName: nextStage.stageName || `Stage ${nextStage.stageNumber}`,
            acceptedCount: 0,
            rejectedCount: 0,
            reworkCount: 0
          },
          $inc: {
            availableQuantity: counts.accepted,
            pendingCount: counts.accepted
          }
        },
        { new: true, upsert: true }
      );

      // 3) Ensure ProcessingStage row exists for the next stage and increment input quantity.
      await ProcessingStage.findOneAndUpdate(
        {
          code,
          stageNumber: nextStage.stageNumber,
          $or: [{ qrId: { $exists: false } }, { qrId: null }]
        },
        {
          $setOnInsert: {
            code,
            stageNumber: nextStage.stageNumber,
            stageName: nextStage.stageName || `Stage ${nextStage.stageNumber}`,
            outputQuantity: 0,
            acceptedQuantity: 0,
            rejectedQuantity: 0,
            reworkQuantity: 0,
            status: 'pending'
          },
          $inc: {
            inputQuantity: counts.accepted,
            // accepted/rejected/rework remain unchanged at this moment
          },
          $set: {
            operator: operatorName
          }
        },
        { new: true, upsert: true }
      );

      for (const qrCodeItem of acceptedQrs) {
        // Mark processed/validated at the current stage
        const processingStage = await ensureProcessingStage({ qrCode: qrCodeItem, stage, operatorName });
        processingStage.reviewStatus = 'accepted';
        processingStage.status = 'completed';
        processingStage.rejectionReason = '';
        processingStage.validatedBy = operatorName;
        processingStage.operator = operatorName;
        processingStage.validated = true;
        await processingStage.save();

        await StageMovementLog.create({
          qrCode: qrCodeItem._id,
          qrId: qrCodeItem.qrId,
          itemId: qrCodeItem.qrId,
          code: qrCodeItem.code,
          batchNo: qrCodeItem.batchNo || '',
          productName: product?.productName || qrCodeItem.code,
          employee: req.user._id,
          employeeName: operatorName,
          fromStageNumber: stageNumber,
          fromStageName: stage.stageName,
          toStageNumber: nextStage.stageNumber,
          toStageName: nextStage.stageName,
          movementType: 'FORWARD',
          remarks: String(remarks || '')
        });

        // Ensure stage row exists for the QR at the next stage (will be reviewed later)
        await ensureProcessingStage({ qrCode: qrCodeItem, stage: nextStage, operatorName });
      }
    } else if (acceptedQrs.length) {
      // Final stage accepted: keep in same stage but update status.
      await QRCode.updateMany(
        { _id: { $in: acceptedQrs.map((q) => q._id) } },
        { $set: { status: 'accepted', currentStage: stageNumber } }
      );

      for (const qrCodeItem of acceptedQrs) {
        const processingStage = await ensureProcessingStage({ qrCode: qrCodeItem, stage, operatorName });
        processingStage.reviewStatus = 'accepted';
        processingStage.status = 'completed';
        processingStage.rejectionReason = '';
        processingStage.validatedBy = operatorName;
        processingStage.operator = operatorName;
        processingStage.validated = true;
        await processingStage.save();
      }
    }

    // Apply rejected (stay in same stage)
    for (const qrCodeItem of rejectedQrs) {
      await QRCode.updateOne(
        { _id: qrCodeItem._id },
        { $set: { status: 'rejected', currentStage: stageNumber } }
      );

      const processingStage = await ensureProcessingStage({ qrCode: qrCodeItem, stage, operatorName });
      processingStage.reviewStatus = 'rejected';
      processingStage.status = 'completed';
      processingStage.rejectionReason = String(remarks || '');
      processingStage.validatedBy = operatorName;
      processingStage.operator = operatorName;
      processingStage.validated = true;
      await processingStage.save();
    }

    // Apply rework (stay in same stage unless your product flow decides otherwise)
    for (const qrCodeItem of reworkQrs) {
      await QRCode.updateOne(
        { _id: qrCodeItem._id },
        { $set: { status: 'rework', currentStage: stageNumber } }
      );

      const processingStage = await ensureProcessingStage({ qrCode: qrCodeItem, stage, operatorName });
      processingStage.reviewStatus = 'rework';
      processingStage.status = 'completed';
      processingStage.rejectionReason = String(remarks || '');
      processingStage.validatedBy = operatorName;
      processingStage.operator = operatorName;
      processingStage.validated = true;
      await processingStage.save();
    }

    // Safety net: ensure every QR we selected from the current qrsPool is updated,
    // preventing employee portal from picking an old "latest" QR stuck in Stage 1.
    // Safety net: ensure every QR we selected from the current qrsPool is updated.
    // This prevents the employee portal from displaying a stale QR as the "latest" one (stuck on Stage 1).
    const selectedQrIds = [...acceptedQrs, ...rejectedQrs, ...reworkQrs].map((q) => q._id);
    if (selectedQrIds.length) {
      await QRCode.updateMany(
        { _id: { $in: selectedQrIds } },
        {
          $set: {
            currentStage: nextStage ? nextStage.stageNumber : stageNumber
          }
        }
      );

      if (acceptedQrs.length && nextStage) {
        await QRCode.updateMany(
          { _id: { $in: acceptedQrs.map((q) => q._id) } },
          { $set: { status: 'processing' } }
        );
      }

      if (rejectedQrs.length) {
        await QRCode.updateMany(
          { _id: { $in: rejectedQrs.map((q) => q._id) } },
          { $set: { status: 'rejected', currentStage: stageNumber } }
        );
      }

      if (reworkQrs.length) {
        await QRCode.updateMany(
          { _id: { $in: reworkQrs.map((q) => q._id) } },
          { $set: { status: 'rework', currentStage: stageNumber } }
        );
      }
    }



    res.status(201).json({ message: 'Batch inspection submitted', response: responseDoc });
  } catch (error) {
    console.error('[inspection submitBatchInspectionResponse] Failed after submit:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.submitInspection = async (req, res) => {
  try {
    const {
      qrId,
      inspectionResult: rawInspectionResult,
      movementType: rawMovementType = 'NONE',
      responses = [],
      remarks = '',
      formId,
      formName
    } = req.body;
    const inspectionResult = normalizeInspectionResult(rawInspectionResult);
    const movementType = normalizeMovementType(rawMovementType);

    if (!qrId) return res.status(400).json({ message: 'qrId is required' });
    if (!['ACCEPTED', 'REJECTED', 'REWORK'].includes(inspectionResult)) {
      return res.status(400).json({ message: 'Inspection result is required' });
    }
    if (!['NONE', 'FORWARD', 'BACKWARD'].includes(movementType)) {
      return res.status(400).json({ message: 'Invalid movement type' });
    }
    if (movementType === 'BACKWARD' && !String(remarks).trim()) {
      return res.status(400).json({ message: 'Remarks are required for backward movement' });
    }

    const qrCode = await QRCode.findOne({ qrId });
    if (!qrCode) return res.status(404).json({ message: 'QR code not found' });

    const { product, stages } = await resolveProductContext(qrCode.code);
    const currentStageNumber = qrCode.currentStage > 0 ? qrCode.currentStage : stages[0]?.stageNumber || 1;
    const currentStage = getStageByNumber(stages, currentStageNumber);
    const reportClassification = getInspectionClassification({
      ...currentStage,
      productName: product?.productName || qrCode.code,
      code: qrCode.code,
      partDescription: product?.description || product?.productName || '',
      stageName: currentStage.stageName,
      formName
    });
    const currentIndex = stages.findIndex((stage) => Number(stage.stageNumber) === Number(currentStage.stageNumber));
    const access = validateEmployeeStageAccess({ employee: req.user, currentStage, stages });

    if (!access.allowed) {
      return res.status(403).json(access.response);
    }

    let toStage = currentStage;
    let effectiveMovementType = movementType;

    if (inspectionResult === 'ACCEPTED' && movementType === 'NONE' && currentIndex < stages.length - 1) {
      effectiveMovementType = 'FORWARD';
    }

    if (effectiveMovementType === 'FORWARD') {
      if (currentIndex >= stages.length - 1) {
        return res.status(400).json({ message: 'Product is already at the final stage' });
      }
      toStage = stages[currentIndex + 1];
    }
    if (effectiveMovementType === 'BACKWARD') {
      if (currentIndex <= 0) {
        return res.status(400).json({ message: 'Product is already at the first stage' });
      }
      toStage = stages[currentIndex - 1];
    }

    const processingStage = await ensureProcessingStage({
      qrCode,
      stage: currentStage,
      operatorName: getEmployeeName(req.user)
    });

    processingStage.reviewStatus = inspectionResult.toLowerCase();
    const responseSummary = summarizeResponses(responses);
    const itemRemarks = String(remarks || '').trim();

    processingStage.reviewAnswers = responses.reduce((acc, item) => {
      acc[item.questionId || item.question] = item.answer;
      return acc;
    }, {});
    processingStage.rejectionReason = ['REJECTED', 'REWORK'].includes(inspectionResult) ? itemRemarks || responseSummary : '';
    processingStage.validatedBy = getEmployeeName(req.user);
    processingStage.operator = getEmployeeName(req.user);
    processingStage.status = inspectionResult === 'ACCEPTED' ? 'validated' : 'completed';
    await processingStage.save();

    if (effectiveMovementType === 'FORWARD' || effectiveMovementType === 'BACKWARD') {
      await StageMovementLog.create({
        qrCode: qrCode._id,
        qrId: qrCode.qrId,
        itemId: qrCode.qrId,
        code: qrCode.code,
        batchNo: qrCode.batchNo || '',
        productName: product?.productName || qrCode.code,
        employee: req.user._id,
        employeeName: getEmployeeName(req.user),
        fromStageNumber: currentStage.stageNumber,
        fromStageName: currentStage.stageName,
        toStageNumber: toStage.stageNumber,
        toStageName: toStage.stageName,
        movementType: effectiveMovementType,
        remarks: itemRemarks
      });

      qrCode.currentStage = toStage.stageNumber;
      qrCode.status = 'processing';

      if (effectiveMovementType === 'FORWARD') {
        await ensureProcessingStage({
          qrCode,
          stage: toStage,
          operatorName: getEmployeeName(req.user)
        });
      }
    }

    if (inspectionResult === 'ACCEPTED' && currentIndex >= stages.length - 1) {
      qrCode.status = 'completed';
    } else if (effectiveMovementType === 'FORWARD') {
      qrCode.status = 'processing';
    } else {
      qrCode.status = inspectionResult.toLowerCase();
    }
    await qrCode.save();

    const responseDoc = await InspectionFormResponse.create({
      qrCode: qrCode._id,
      qrId: qrCode.qrId,
      itemId: qrCode.qrId,
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: product?.productName || qrCode.code,
      code: qrCode.code,
      batchNo: qrCode.batchNo || '',
      partDescription: product?.description || product?.productName || '',
      ...reportClassification,
      stageNumber: currentStage.stageNumber,
      stageName: currentStage.stageName,
      formId: formId || `stage-${currentStage.stageNumber}`,
      formName: formName || `${currentStage.stageName} Inspection`,
      inspectionResult,
      responses,
      remarks: itemRemarks,
      movement: {
        type: effectiveMovementType,
        fromStageNumber: currentStage.stageNumber,
        fromStageName: currentStage.stageName,
        toStageNumber: toStage.stageNumber,
        toStageName: toStage.stageName
      }
    });

    await InspectionScanLog.create({
      qrCode: qrCode._id,
      qrId: qrCode.qrId,
      itemId: qrCode.qrId,
      employee: req.user._id,
      employeeName: getEmployeeName(req.user),
      productName: product?.productName || qrCode.code,
      code: qrCode.code,
      partDescription: product?.description || product?.productName || '',
      stageNumber: currentStage.stageNumber,
      stageName: currentStage.stageName,
      status: inspectionResult,
      actionTaken: effectiveMovementType === 'NONE' ? inspectionResult : `${inspectionResult}_${effectiveMovementType}`,
      remarks: itemRemarks,
      location: toStage.stageName
    });

    res.status(201).json({ message: 'Inspection submitted', response: responseDoc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.submitEmployeeInspectionResponse = async (req, res) => {
  // Batch path: keep existing behavior.
  if (
    req.body.acceptedCount !== undefined ||
    req.body.rejectedCount !== undefined ||
    req.body.reworkCount !== undefined
  ) {
    return exports.submitBatchInspectionResponse(req, res);
  }

  // Normalise common frontend payload shapes into what submitInspection expects:
  // - qrId
  // - inspectionResult: ACCEPTED|REJECTED|REWORK
  // - movementType: NONE|FORWARD|BACKWARD
  // - responses: [{ questionId/question, answer }]
  // - remarks
  //
  // Important: do NOT blindly overwrite req.body if frontend already sent the correct keys.
  const {
    itemId,
    qrId,
    selectedStatus,
    inspectionResult,
    movementType,
    selectedMovementType,
    remarks,
    formResponses,
    responses,
    formId,
    formName
  } = req.body || {};

  req.body = {
    ...req.body,
    qrId: qrId || itemId,
    inspectionResult: inspectionResult || selectedStatus,
    movementType: movementType || selectedMovementType || 'NONE',
    remarks: remarks ?? req.body?.remarks ?? '',
    responses: formResponses || responses || [],
    formId: formId,
    formName: formName
  };

  // Reuse existing submitInspection implementation.
  return exports.submitInspection(req, res);
};

exports.getProductHistoryByItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const qrCode = await QRCode.findOne({ $or: [{ qrId: itemId }, { code: itemId }, { batchNo: itemId }] });
    if (!qrCode) return res.status(404).json({ message: 'Product item not found' });
    req.params.id = qrCode.qrId;
    return exports.getTraceability(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const { start, end } = todayRange();
    const employee = req.user._id;

    const [scans, responses, movements, recentActivity] = await Promise.all([
      InspectionScanLog.countDocuments({ employee, createdAt: { $gte: start, $lt: end } }),
      InspectionFormResponse.find({ employee, submittedAt: { $gte: start, $lt: end } }),
      StageMovementLog.find({ employee, movedAt: { $gte: start, $lt: end } }),
      InspectionScanLog.find({ employee }).sort({ createdAt: -1 }).limit(10)
    ]);

    res.json({
      today: {
        totalScans: scans,
        accepted: responses.reduce((sum, item) => sum + (item.acceptedCount || (item.inspectionResult === 'ACCEPTED' ? 1 : 0)), 0),
        rejected: responses.reduce((sum, item) => sum + (item.rejectedCount || (item.inspectionResult === 'REJECTED' ? 1 : 0)), 0),
        rework: responses.reduce((sum, item) => sum + (item.reworkCount || (item.inspectionResult === 'REWORK' ? 1 : 0)), 0),
        productsProcessedToday: responses.reduce((sum, item) => sum + (item.acceptedCount || 0) + (item.rejectedCount || 0) + (item.reworkCount || 0), 0) || responses.length,
        pendingReviews: Math.max(scans - responses.length, 0),
        forwardedToNextStage: movements.filter((item) => item.movementType === 'FORWARD').length,
        sentBackToPreviousStage: movements.filter((item) => item.movementType === 'BACKWARD').length
      },
      recentActivity
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getScanLogs = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;

    // Only show scans for the logged-in employee.
    // Aggregation does not cast ObjectId strings, so match both forms.
    const employeeMatch = employeeIdMatch(req.user._id);

    const searchMatch = search
      ? {
          $or: [
            { code: { $regex: search, $options: 'i' } },
            { productName: { $regex: search, $options: 'i' } },
            { partDescription: { $regex: search, $options: 'i' } }
          ]
        }
      : {};

    const matchStages = [employeeMatch];
    if (Object.keys(searchMatch).length) matchStages.push(searchMatch);

    const grouped = await InspectionScanLog.aggregate([
      { $match: { $and: matchStages } },

      // Ensure "latest" is deterministic
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          // Group by productName; we will also expose code (QR code) separately.
          _id: '$productName',
          productName: { $first: '$productName' },
          code: { $first: '$code' },
          partDescription: { $first: '$partDescription' },
          currentStage: { $first: '$stageName' },
          lastAction: { $first: '$actionTaken' },
          lastUpdated: { $first: '$updatedAt' }
        }
      },

      { $sort: { lastUpdated: -1 } },
      { $skip: (Number(page) - 1) * Number(limit) },
      { $limit: Number(limit) }
    ]);

    const rows = await Promise.all(
      grouped.map(async (row) => {
        // Build metrics using the underlying QRCode.code values.
        const relatedCodes = await InspectionScanLog.distinct('code', {
          ...employeeMatch,
          productName: row.productName
        });


        const [totalIdealProductCount, acceptedCount, rejectedCount, reworkCount] = await Promise.all([
          QRCode.countDocuments({ code: { $in: relatedCodes } }),
          InspectionFormResponse.aggregate([
            { $match: { code: { $in: relatedCodes }, ...employeeMatch } },
            { $group: { _id: null, count: { $sum: '$acceptedCount' } } }
          ]),
          InspectionFormResponse.aggregate([
            { $match: { code: { $in: relatedCodes }, ...employeeMatch } },
            { $group: { _id: null, count: { $sum: '$rejectedCount' } } }
          ]),
          InspectionFormResponse.aggregate([
            { $match: { code: { $in: relatedCodes }, ...employeeMatch } },
            { $group: { _id: null, count: { $sum: '$reworkCount' } } }
          ])
        ]);

        const acceptedItems = acceptedCount[0]?.count || 0;
        const rejectedItems = rejectedCount[0]?.count || 0;
        const reworkItems = reworkCount[0]?.count || 0;

        return {
          // Keep frontend compatibility:
          // - UI column "Code" will show code compatibility value
          // - UI "Part Description" shows partDescription
          // - Add productName for future UI improvements
          ...row,
          productName: row.productName || '',
          totalIdealProductCount,
          acceptedCount: acceptedItems,
          rejectedCount: rejectedItems,
          reworkCount: reworkItems,
          pendingCount: Math.max(
            totalIdealProductCount - acceptedItems - rejectedItems - reworkItems,
            0
          )
        };
      })
    );

    const detailMatch = {
      ...employeeMatch,
      ...(search
        ? {
            $or: [
              { code: { $regex: search, $options: 'i' } },
              { productName: { $regex: search, $options: 'i' } },
              { partDescription: { $regex: search, $options: 'i' } },
              { stageName: { $regex: search, $options: 'i' } }
            ]
          }
        : {})
    };
    const detailRows = await InspectionFormResponse.find(detailMatch)
      .sort({ submittedAt: 1, createdAt: 1 })
      .lean();
    const acceptedBeforeByStage = new Map();
    const details = detailRows.map((item) => {
      const key = `${item.code}::${item.stageNumber}`;
      const previousAcceptedCount = acceptedBeforeByStage.get(key) || 0;
      acceptedBeforeByStage.set(key, previousAcceptedCount + Number(item.acceptedCount || 0));
      return { ...item, previousAcceptedCount };
    }).reverse().slice(0, Number(limit) * 5);


    res.json({
      success: true,
      logs: rows,
      rows,
      details,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTraceability = async (req, res) => {
  try {
    const id = req.params.id;
    const qrCode = await QRCode.findOne({ $or: [{ _id: id.match(/^[a-f\d]{24}$/i) ? id : undefined }, { qrId: id }, { code: id }] });
    const code = qrCode?.code || id;

    const [productContext, scanLogs, responses, movements, qrCodes] = await Promise.all([
      resolveProductContext(code),
      InspectionScanLog.find({ code }).sort({ createdAt: 1 }),
      InspectionFormResponse.find({ code }).sort({ submittedAt: 1 }),
      StageMovementLog.find({ code }).sort({ movedAt: 1 }),
      QRCode.find({ code }).sort({ createdAt: 1 })
    ]);

    res.json({
      product: productContext.product,
      stages: productContext.stages,
      qrCodes,
      scanLogs,
      responses,
      movements
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAdminResponses = async (req, res) => {
  try {
    const { search = '', result = '', stage = '' } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } },
        { employeeName: { $regex: search, $options: 'i' } }
      ];
    }
    if (result) query.inspectionResult = result;
    if (stage) query.stageNumber = Number(stage);

    const responses = await InspectionFormResponse.find(query).sort({ submittedAt: -1 }).limit(200).lean();
    const enrichedResponses = await Promise.all(responses.map(async (response) => {
      const qrCode = response.qrCode
        ? await QRCode.findById(response.qrCode).lean()
        : await QRCode.findOne({ qrId: response.qrId }).lean();
      const product = await getProductWithCategoryForResponse(response, qrCode);
      const category = product?.category;
      const categoryId = category?._id ? String(category._id) : '';
      const categoryName = category?.name || '';

      if (!qrCode) {
        return {
          ...response,
          categoryId,
          categoryName,
          currentStageNumber: response.stageNumber,
          currentStageName: response.stageName
        };
      }

      const { stages } = await resolveProductContext(qrCode.code);
      const finalStageNumber = Number(stages[stages.length - 1]?.stageNumber || 1);
      const currentStageNumber = Number(qrCode.currentStage || stages[0]?.stageNumber || 1);
      const currentStage = getStageByNumber(stages, currentStageNumber);
      const isCompleted = qrCode.status === 'completed' || (qrCode.status === 'accepted' && currentStageNumber >= finalStageNumber);

      return {
        ...response,
        categoryId,
        categoryName,
        currentStageNumber,
        currentStageName: isCompleted ? 'Completed' : stageLabel(currentStageNumber, currentStage),
        itemStatus: qrCode.status || 'generated'
      };
    }));
    const totalResponses = await InspectionFormResponse.countDocuments(query);
    const analyticsRows = await InspectionFormResponse.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          acceptedItems: { $sum: '$acceptedCount' },
          rejectedItems: { $sum: '$rejectedCount' },
          reworkItems: { $sum: '$reworkCount' },
          acceptedResponses: { $sum: { $cond: [{ $eq: ['$inspectionResult', 'ACCEPTED'] }, 1, 0] } },
          rejectedResponses: { $sum: { $cond: [{ $eq: ['$inspectionResult', 'REJECTED'] }, 1, 0] } },
          reworkResponses: { $sum: { $cond: [{ $eq: ['$inspectionResult', 'REWORK'] }, 1, 0] } }
        }
      }
    ]);

    const analytics = {
      totalResponses,
      acceptedResponses: 0,
      rejectedResponses: 0,
      reworkResponses: 0,
      acceptedItems: 0,
      rejectedItems: 0,
      reworkItems: 0
    };
    Object.assign(analytics, analyticsRows[0] || {});

    res.json({ responses: enrichedResponses, analytics });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getResponseById = async (req, res) => {
  try {
    const response = await InspectionFormResponse.findById(req.params.id);
    if (!response) return res.status(404).json({ message: 'Response not found' });
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductionAnalytics = async (req, res) => {
  try {
    const [totals, stageWise, productWise, employeeWise] = await Promise.all([
      InspectionFormResponse.aggregate([
        {
          $group: {
            _id: null,
            accepted: { $sum: '$acceptedCount' },
            rejected: { $sum: '$rejectedCount' },
            rework: { $sum: '$reworkCount' }
          }
        }
      ]),
      InspectionFormResponse.aggregate([
        {
          $group: {
            _id: '$stageName',
            accepted: { $sum: '$acceptedCount' },
            rejected: { $sum: '$rejectedCount' },
            rework: { $sum: '$reworkCount' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      InspectionFormResponse.aggregate([
        {
          $group: {
            _id: '$productName',
            accepted: { $sum: '$acceptedCount' },
            rejected: { $sum: '$rejectedCount' },
            rework: { $sum: '$reworkCount' }
          }
        },
        { $sort: { accepted: -1 } },
        { $limit: 10 }
      ]),
      InspectionFormResponse.aggregate([
        {
          $group: {
            _id: '$employeeName',
            accepted: { $sum: '$acceptedCount' },
            rejected: { $sum: '$rejectedCount' },
            rework: { $sum: '$reworkCount' }
          }
        },
        { $sort: { accepted: -1 } },
        { $limit: 10 }
      ])
    ]);
    const total = totals[0] || { accepted: 0, rejected: 0, rework: 0 };
    const processed = total.accepted + total.rejected + total.rework;
    res.json({
      totals: {
        ...total,
        acceptancePercent: processed ? Math.round((total.accepted / processed) * 100) : 0,
        rejectionPercent: processed ? Math.round((total.rejected / processed) * 100) : 0,
        reworkPercent: processed ? Math.round((total.rework / processed) * 100) : 0
      },
      stageWise,
      productWise,
      employeeWise
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRejectionReport = async (req, res) => {
  try {
    const now = new Date();
    const month = Math.min(Math.max(Number(req.query.month) || now.getMonth() + 1, 1), 12);
    const year = Number(req.query.year) || now.getFullYear();
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const responses = await InspectionFormResponse.find({
      submittedAt: { $gte: start, $lt: end }
    })
      .select('acceptedCount rejectedCount reworkCount rejectionFormResponses submittedAt')
      .lean();

    const makeDayTotals = () =>
      Array.from({ length: daysInMonth }, (_, index) => ({
        day: index + 1,
        output: 0,
        rejection: 0,
        rejectionPercent: 0
      }));

    const dayTotals = makeDayTotals();
    const rowMap = new Map();
    const totals = { output: 0, rejection: 0, rejectionPercent: 0 };

    const ensureRow = (detail) => {
      const key = String(detail || 'Unspecified rejection').trim() || 'Unspecified rejection';
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          defectGroup: 'Rejection',
          rejectionDetails: key,
          days: makeDayTotals(),
          total: 0,
          totalPercent: 0
        });
      }
      return rowMap.get(key);
    };

    const getResponseCount = (answer) => {
      if (answer?.type !== 'count') return 0;
      return Math.max(0, Number(answer.answer) || 0);
    };

    for (const response of responses) {
      const accepted = Math.max(0, Number(response.acceptedCount) || 0);
      const rejected = Math.max(0, Number(response.rejectedCount) || 0);
      const rework = Math.max(0, Number(response.reworkCount) || 0);
      const output = accepted + rejected + rework;
      const dayIndex = Math.max(0, Math.min(daysInMonth - 1, new Date(response.submittedAt).getDate() - 1));

      dayTotals[dayIndex].output += output;
      dayTotals[dayIndex].rejection += rejected;
      totals.output += output;
      totals.rejection += rejected;

      const rejectionResponses = Array.isArray(response.rejectionFormResponses)
        ? response.rejectionFormResponses
        : [];

      for (const answer of rejectionResponses) {
        const count = getResponseCount(answer);
        if (!count) continue;
        const detail = answer.defectDetail || answer.optionKey || answer.question || 'Unspecified rejection';
        const row = ensureRow(detail);
        row.days[dayIndex].rejection += count;
        row.total += count;
      }
    }

    for (const day of dayTotals) {
      day.rejectionPercent = day.output ? Number(((day.rejection / day.output) * 100).toFixed(2)) : 0;
    }

    totals.rejectionPercent = totals.output ? Number(((totals.rejection / totals.output) * 100).toFixed(2)) : 0;

    const rows = Array.from(rowMap.values())
      .map((row) => ({
        ...row,
        totalPercent: totals.rejection ? Number(((row.total / totals.rejection) * 100).toFixed(2)) : 0
      }))
      .sort((a, b) => b.total - a.total || a.rejectionDetails.localeCompare(b.rejectionDetails));

    res.json({
      month,
      year,
      days: dayTotals,
      totals,
      rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMisDashboard = async (req, res) => {
  try {
    const now = new Date();
    const month = Math.min(Math.max(Number(req.query.month) || now.getMonth() + 1, 1), 12);
    const year = Number(req.query.year) || now.getFullYear();
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const responses = await InspectionFormResponse.find({
      submittedAt: { $gte: start, $lt: end }
    })
      .select([
        'productName', 'code', 'partDescription', 'productionLine', 'reportType',
        'processKey', 'processName', 'partKey', 'partName', 'stageNumber', 'stageName', 'formName',
        'acceptedCount', 'rejectedCount', 'reworkCount', 'responses',
        'rejectionFormResponses', 'reworkFormResponses', 'submittedAt'
      ].join(' '))
      .lean();

    const makeDays = () => Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      accepted: 0,
      rejected: 0,
      rework: 0,
      output: 0,
      rejection: 0,
      rejectionAndRework: 0,
      rejectionPercent: 0,
      rejectionAndReworkPercent: 0
    }));
    const reports = {};
    const productCodes = [...new Set(responses.map((response) => response.code).filter(Boolean))];
    const productsByCode = new Map((await Product.find({ code: { $in: productCodes } })
      .select('code productName category subcategory')
      .populate('category', 'name')
      .populate('subcategory', 'name category')
      .lean()).map((product) => [product.code, product]));
    const responseProductNames = [
      ...new Set(responses.map((response) => response.productName).filter(Boolean))
    ];
    const configsByProductName = new Map((await ManufacturingConfig.find({
      productName: { $in: responseProductNames }
    }).lean()).map((config) => [normalizeReportText(config.productName), config]));

    const ensureReport = (reportId, classification) => {
      if (!reports[reportId]) {
        reports[reportId] = {
          reportId,
          productionLine: classification.productionLine,
          reportType: classification.reportType,
          processKey: classification.processKey,
          processName: classification.processName,
          partKey: classification.partKey,
          partName: classification.partName,
          days: makeDays(),
          totals: {
            accepted: 0,
            rejected: 0,
            rework: 0,
            output: 0,
            rejection: 0,
            rejectionAndRework: 0,
            rejectionPercent: 0,
            rejectionAndReworkPercent: 0
          },
          rows: {},
          processRows: {}
        };
      }
      return reports[reportId];
    };

    const resolveQuestionnaireLabels = (response, answer, type) => {
      const config = configsByProductName.get(normalizeReportText(response?.productName));
      const stage = (config?.stages || []).find((item) => Number(item.stageNumber) === Number(response?.stageNumber));
      const formDefinition = type === 'rework'
        ? stage?.reviewForm?.reworkForm
        : stage?.reviewForm?.rejectionForm;
      const questions = formDefinition?.questions || [];
      const answerQuestionId = String(answer?.questionId || '').trim();
      const answerOptionKey = String(answer?.optionKey || '').trim();

      const findNestedQuestion = (rootQuestion, parentOption, nestedQuestions = [], path = []) => {
        for (const nestedQuestion of nestedQuestions || []) {
          const nestedQuestionText = String(nestedQuestion?.questionText || nestedQuestion?.label || nestedQuestion?.question || '').trim();
          const nestedQuestionId = String(nestedQuestion?.questionId || nestedQuestion?.id || '').trim();
          for (const nestedOption of nestedQuestion?.options || []) {
            const nestedOptionLabel = String(nestedOption?.label || nestedOption?.value || '').trim();
            const nestedOptionId = String(nestedOption?.optionId || nestedOption?.id || '').trim();
            const nestedOptionMatches = answerOptionKey && [nestedOptionId, nestedOptionLabel].includes(answerOptionKey);
            const nextPath = nestedQuestionText && (nestedOptionLabel || answerOptionKey)
              ? [...path, { question: nestedQuestionText, option: nestedOptionLabel || answerOptionKey }]
              : path;
            if (nestedQuestionId === answerQuestionId && nestedOptionMatches) {
              return {
                rootQuestion,
                parentOption,
                subQuestion: nestedQuestionText,
                subOption: nestedOptionLabel || answerOptionKey,
                subQuestionPath: nextPath,
                defectName: nestedOptionLabel || answerOptionKey,
                hasSubQuestion: true
              };
            }
            const deeperMatch = findNestedQuestion(rootQuestion, parentOption, nestedOption?.subQuestions || [], nextPath);
            if (deeperMatch) {
              return {
                ...deeperMatch,
                subQuestion: deeperMatch.subQuestion || nestedQuestionText,
                subOption: deeperMatch.subOption || nestedOptionLabel || answerOptionKey,
                subQuestionPath: deeperMatch.subQuestionPath?.length ? deeperMatch.subQuestionPath : nextPath
              };
            }
          }
          if (nestedQuestionId === answerQuestionId) {
            const currentOption = String(answer?.subOption || '').trim();
            return {
              rootQuestion,
              parentOption,
              subQuestion: nestedQuestionText,
              subOption: currentOption,
              subQuestionPath: nestedQuestionText && currentOption ? [...path, { question: nestedQuestionText, option: currentOption }] : path,
              defectName: String(answer?.defectDetail || answer?.defectType || nestedQuestionText).trim(),
              hasSubQuestion: true
            };
          }
        }
        return null;
      };

      for (const question of questions) {
        const rootQuestion = String(question?.questionText || question?.label || question?.question || '').trim();
        for (const option of question?.options || []) {
          const optionLabel = String(option?.label || option?.value || '').trim();
          const optionId = String(option?.optionId || option?.id || '').trim();
          const optionMatches = answerOptionKey && [optionId, optionLabel].includes(answerOptionKey);

          if (String(question?.questionId || question?.id || '').trim() === answerQuestionId && optionMatches) {
              return {
                rootQuestion,
                parentOption: optionLabel || answerOptionKey,
                defectName: '',
                hasSubQuestion: false
              };
          }

          const nestedMatch = findNestedQuestion(rootQuestion, optionLabel || answer?.parentOption || answerOptionKey || 'Unspecified', option?.subQuestions || []);
          if (nestedMatch) return nestedMatch;
        }
      }

      return null;
    };

    const getCountAnswers = (answers = [], type, classification, response = {}) => (answers || [])
      .filter((answer) => normalizeReportText(answer?.type) === 'count')
      .map((answer) => {
        const currentLabels = resolveQuestionnaireLabels(response, answer, type) || {};
        const rootQuestion = String(currentLabels.rootQuestion || answer?.rootQuestion || answer?.question || (type === 'rework' ? 'Rework Reason' : 'Rejection Reason')).trim();
        const parentOption = String(currentLabels.parentOption || answer?.parentOption || answer?.optionKey || 'Unspecified').trim();
        const subQuestion = String(currentLabels.subQuestion || answer?.subQuestion || '').trim();
        const subOption = String(currentLabels.subOption || answer?.subOption || '').trim();
        const subQuestionPath = Array.isArray(currentLabels.subQuestionPath) && currentLabels.subQuestionPath.length
          ? currentLabels.subQuestionPath
          : subQuestion && subOption
            ? [{ question: subQuestion, option: subOption }]
            : [];
        const defectName = String(currentLabels.defectName || answer?.defectDetail || answer?.defectType || answer?.question || 'Unspecified').trim();
        const hasSubQuestion = currentLabels.hasSubQuestion ?? (
          Boolean(answer?.rootQuestion || answer?.parentOption || answer?.subQuestion || answer?.subOption)
          && normalizeReportText(answer?.defectDetail || answer?.defectType || answer?.question)
            !== normalizeReportText(answer?.parentOption || answer?.optionKey)
        );
        const processName = String(answer?.assemblyProcess || classification.processName || '').trim();
        const partName = String(response?.productName || response?.partName || classification.partName || '').trim();
        return {
          key: toKey(`${rootQuestion} ${parentOption} ${partName} ${subQuestion} ${subOption} ${defectName}`),
          questionHeader: rootQuestion,
          questionAnswer: parentOption,
          subQuestion,
          subOption,
          subQuestionPath,
          name: defectName,
          hasSubQuestion,
          processName,
          partName,
          count: toCount(answer?.answer)
        };
      })
      .filter((answer) => answer.count > 0);

    const addDefects = (report, answers, dayIndex) => {
      for (const answer of answers) {
        if (!report.rows[answer.key]) {
          report.rows[answer.key] = {
            defectCode: answer.key,
            questionHeader: answer.questionHeader || '',
            questionAnswer: answer.questionAnswer || '',
            subQuestion: answer.subQuestion || '',
            subOption: answer.subOption || '',
            subQuestionPath: answer.subQuestionPath || [],
            hasSubQuestion: Boolean(answer.hasSubQuestion),
            defectName: answer.name,
            assemblyProcess: answer.processName || '',
            partName: answer.partName || '',
            days: Array(daysInMonth).fill(0),
            total: 0
          };
        }
        report.rows[answer.key].days[dayIndex] += answer.count;
        report.rows[answer.key].total += answer.count;
      }
    };

    const addProcessOutput = (report, response, dayIndex, output, rejection) => {
      const partName = String(response?.productName || response?.partName || report.partName || 'Unspecified').trim();
      const processName = String(response?.processName || response?.stageName || report.processName || 'Unspecified').trim();
      const key = toKey(`${partName} ${processName}`);
      if (!report.processRows[key]) {
        report.processRows[key] = {
          key,
          partName,
          processName,
          days: Array.from({ length: daysInMonth }, () => ({ output: 0, rejection: 0 })),
          totalOutput: 0,
          totalRejection: 0
        };
      }
      report.processRows[key].days[dayIndex].output += output;
      report.processRows[key].days[dayIndex].rejection += rejection;
      report.processRows[key].totalOutput += output;
      report.processRows[key].totalRejection += rejection;
    };

    for (const response of responses) {
      const classification = getInspectionClassification(response);
      const product = productsByCode.get(response.code);
      const categoryId = product?.category?._id ? String(product.category._id) : '';
      const subcategoryId = product?.subcategory?._id ? String(product.subcategory._id) : '';
      const dynamicReportId = subcategoryId
        ? `product-subcategory-${subcategoryId}`
        : categoryId
          ? `product-category-${categoryId}-all`
          : '';
      const primaryReportId = classification.productionLine && classification.reportType
        ? reportIdFor(classification.productionLine, classification.reportType)
        : '';
      if (!primaryReportId && !dynamicReportId) continue;

      const reportIds = [primaryReportId, dynamicReportId].filter(Boolean);
      if (dynamicReportId) {
        reportIds.push(`${dynamicReportId}-mis`);
        reportIds.push(`${dynamicReportId}-crs`);
        reportIds.push(`${dynamicReportId}-rejection`);
        reportIds.push(`${dynamicReportId}-rework`);
      }
      if (classification.reportType === 'helmet-assembly') {
        const line = normalizeReportText(classification.productionLine);
        reportIds.push(`${line}-helmet-assembly-rejection`);
        reportIds.push(`${line}-helmet-assembly-rework`);
        reportIds.push(`stagewise-rejection-performance-${line}`);
      }

      const accepted = toCount(response.acceptedCount);
      const rejected = toCount(response.rejectedCount);
      const rework = toCount(response.reworkCount);
      const output = accepted + rejected + rework;
      const dayIndex = Math.max(0, Math.min(daysInMonth - 1, new Date(response.submittedAt).getDate() - 1));
      const inspectionDefects = getCountAnswers(response.responses, 'reject', classification, response);
      const rejectionDefects = getCountAnswers(response.rejectionFormResponses, 'reject', classification, response);
      const reworkDefects = getCountAnswers(response.reworkFormResponses, 'rework', classification, response);

      for (const reportId of reportIds) {
        const report = ensureReport(reportId, classification);
        const day = report.days[dayIndex];
        day.accepted += accepted;
        day.rejected += rejected;
        day.rework += rework;
        day.output += output;
        day.rejection += rejected;
        day.rejectionAndRework += rejected + rework;

        report.totals.accepted += accepted;
        report.totals.rejected += rejected;
        report.totals.rework += rework;
        report.totals.output += output;
        report.totals.rejection += rejected;
        report.totals.rejectionAndRework += rejected + rework;
        addProcessOutput(report, response, dayIndex, output, rejected);

        const isRejectionReport = reportId.endsWith('-helmet-assembly-rejection');
        const isReworkReport = reportId.endsWith('-helmet-assembly-rework');
        const isDynamicRejectionReport = reportId.endsWith('-rejection');
        const isDynamicCrsReport = reportId.endsWith('-crs');
        const isDynamicReworkReport = reportId.endsWith('-rework');
        addDefects(
          report,
          isRejectionReport || isDynamicRejectionReport || isDynamicCrsReport
            ? rejectionDefects
            : isReworkReport || isDynamicReworkReport
              ? reworkDefects
              : [...inspectionDefects, ...rejectionDefects, ...reworkDefects],
          dayIndex
        );
      }
    }

    for (const report of Object.values(reports)) {
      for (const day of report.days) {
        day.rejectionPercent = day.output ? Number(((day.rejection / day.output) * 100).toFixed(2)) : 0;
        day.rejectionAndReworkPercent = day.output
          ? Number(((day.rejectionAndRework / day.output) * 100).toFixed(2))
          : 0;
      }
      report.totals.rejectionPercent = report.totals.output
        ? Number(((report.totals.rejection / report.totals.output) * 100).toFixed(2))
        : 0;
      report.totals.rejectionAndReworkPercent = report.totals.output
        ? Number(((report.totals.rejectionAndRework / report.totals.output) * 100).toFixed(2))
        : 0;
      report.rows = Object.values(report.rows).sort((a, b) =>
        b.total - a.total || a.defectName.localeCompare(b.defectName)
      );
      report.processRows = Object.values(report.processRows).sort((a, b) =>
        a.partName.localeCompare(b.partName) || a.processName.localeCompare(b.processName)
      );
    }

    res.json({ month, year, daysInMonth, reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.backfillMisClassification = async (req, res) => {
  try {
    const query = {
      $or: [
        { productionLine: { $exists: false } },
        { productionLine: '' },
        { reportType: { $exists: false } },
        { reportType: '' }
      ]
    };
    const responses = await InspectionFormResponse.find(query)
      .select('productName code partDescription stageName formName productionLine reportType processKey processName partKey partName')
      .lean();

    const operations = responses
      .map((response) => ({
        response,
        classification: getInspectionClassification(response)
      }))
      .filter(({ classification }) => classification.productionLine && classification.reportType)
      .map(({ response, classification }) => ({
        updateOne: {
          filter: { _id: response._id },
          update: { $set: classification }
        }
      }));

    if (operations.length) {
      await InspectionFormResponse.bulkWrite(operations, { ordered: false });
    }

    res.json({
      scanned: responses.length,
      updated: operations.length,
      skipped: responses.length - operations.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.syncMisTaxonomy = async (req, res) => {
  try {
    const configs = await ManufacturingConfig.find({});
    let configsUpdated = 0;
    let stagesUpdated = 0;
    let stagesSkipped = 0;

    for (const config of configs) {
      let changed = false;
      config.stages = config.stages.map((stage) => {
        const classification = getInspectionClassification({
          ...stage.toObject(),
          productName: config.productName,
          stageName: stage.stageName,
          processName: stage.processName || stage.stageName,
          partName: stage.partName || config.productName
        });
        if (!classification.productionLine || !classification.reportType) {
          stagesSkipped += 1;
          return stage;
        }
        const current = stage.toObject();
        const differs = Object.entries(classification).some(([key, value]) => String(current[key] || '') !== String(value || ''));
        if (!differs) return stage;
        changed = true;
        stagesUpdated += 1;
        return { ...current, ...classification };
      });
      if (changed) {
        await config.save();
        configsUpdated += 1;
      }
    }

    const responseQuery = {
      $or: [
        { productionLine: { $exists: false } },
        { productionLine: '' },
        { reportType: { $exists: false } },
        { reportType: '' }
      ]
    };
    const responses = await InspectionFormResponse.find(responseQuery)
      .select('productName code partDescription stageName formName productionLine reportType processKey processName partKey partName')
      .lean();
    const responseOperations = responses
      .map((response) => ({
        response,
        classification: getInspectionClassification(response)
      }))
      .filter(({ classification }) => classification.productionLine && classification.reportType)
      .map(({ response, classification }) => ({
        updateOne: {
          filter: { _id: response._id },
          update: { $set: classification }
        }
      }));
    if (responseOperations.length) {
      await InspectionFormResponse.bulkWrite(responseOperations, { ordered: false });
    }

    res.json({
      configsScanned: configs.length,
      configsUpdated,
      stagesUpdated,
      stagesSkipped,
      responsesScanned: responses.length,
      responsesUpdated: responseOperations.length,
      responsesSkipped: responses.length - responseOperations.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMisTaxonomy = async (req, res) => {
  res.json({
    productionLines: ['D1', 'D2', 'D3', 'D4'],
    reportTypes: [
      { value: 'helmet-assembly', label: 'Helmet Assembly' },
      { value: 'visor-moulding', label: 'Visor Moulding' },
      { value: 'visor-mechanism-top-moulding', label: 'Visor Mechanism Top Moulding' },
      { value: 'visor-coating', label: 'Visor Coating' },
      { value: 'shell-moulding', label: 'Shell Moulding' },
      { value: 'chin-cover-moulding', label: 'Chin Cover Moulding' },
      { value: 'spoiler-moulding', label: 'Spoiler Moulding' },
      { value: 'stagewise-rejection', label: 'Stagewise Rejection' },
      { value: 'bop-parts-receipt', label: 'BOP Parts Receipt' }
    ]
  });
};
