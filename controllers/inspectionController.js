const InspectionFormResponse = require('../models/InspectionFormResponse');
const InspectionScanLog = require('../models/InspectionScanLog');
const QRCode = require('../models/QRCode');
const Product = require('../models/Product');
const StageMovementLog = require('../models/StageMovementLog');
const ProcessingStage = require('../models/ProcessingStage');
const ProductStage = require('../models/ProductStage');
const mongoose = require('mongoose');
const {
  buildProductPayload,
  ensureProcessingStage,
  getStageByNumber,
  resolveProductContext
} = require('../services/inspectionService');

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

  const qrCount = await QRCode.countDocuments({
    code: { $in: normalizedCodes },
    currentStage: normalizedStageNumber
  });
  if (qrCount > 0) return qrCount;

  const productStages = await ProductStage.find({
    code: { $in: normalizedCodes },
    stageNumber: normalizedStageNumber
  }).lean();

  const productStageCount = productStages.reduce((sum, row) => {
    const pending = Number(row.pendingCount);
    if (Number.isFinite(pending) && pending > 0) return sum + pending;
    const available = Number(row.availableQuantity || 0);
    const processed = Number(row.acceptedCount || 0) + Number(row.rejectedCount || 0) + Number(row.reworkCount || 0);
    return sum + Math.max(available - processed, 0);
  }, 0);
  if (productStageCount > 0) return productStageCount;

  const processingStages = await ProcessingStage.find({
    code: { $in: normalizedCodes },
    stageNumber: normalizedStageNumber,
    $or: [{ qrId: { $exists: false } }, { qrId: null }]
  }).lean();

  return processingStages.reduce((sum, row) => {
    const input = Number(row.inputQuantity || 0);
    const processed = Number(row.acceptedQuantity || 0) + Number(row.rejectedQuantity || 0) + Number(row.reworkQuantity || 0);
    return sum + Math.max(input - processed, 0);
  }, 0);
};

const buildEmployeeStageRows = async ({ codes = [], stages = [], employee }) => {
  const normalizedCodes = codes.filter(Boolean);
  return Promise.all(
    stages.map(async (stage) => ({
      stageNumber: stage.stageNumber,
      stageName: stage.stageName,
      stageType: stage.stageType,
      selectable: canEmployeeProcessStage(employee, stage.stageNumber),
      availableCount: normalizedCodes.length
        ? await getAvailableCountForStage(normalizedCodes, stage.stageNumber)
        : 0
    }))
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
    const assignedStageNumbers = req.user?.role === 'employee'
      ? (
          Array.isArray(req.user.assignedStages) && req.user.assignedStages.length
            ? req.user.assignedStages.map((stage) => Number(stage.stageNumber || stage)).filter(Number.isFinite)
            : [Number(req.user.manufacturingLevel || 1)]
        )
      : [];
    const stageMatch = assignedStageNumbers.length
      ? { currentStage: { $in: assignedStageNumbers } }
      : {};

    // If employee searches by product name, we must return product-level entry
    // and show overall total QR count under that product.
    const productRows = await Product.find(
      term
        ? {
            $or: [
              { productName: { $regex: term, $options: 'i' } },
              { code: { $regex: term, $options: 'i' } }
            ]
          }
        : {}
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
          ? await QRCode.find({ code: { $in: codes }, ...stageMatch }).sort({ updatedAt: -1 }).limit(1).lean()
          : null;

        const latestQr = latestQrRows?.[0];
        const { stages } = await resolveProductContext(codes[0]);
        const stageCounts = await Promise.all(
          (stages || []).map(async (stage) => ({
            stageNumber: Number(stage.stageNumber),
            count: await getAvailableCountForStage(codes, stage.stageNumber)
          }))
        );
        const availableCount = assignedStageNumbers.length
          ? stageCounts
              .filter((item) => assignedStageNumbers.includes(item.stageNumber))
              .reduce((sum, item) => sum + item.count, 0)
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

    const productMatch = await Product.findOne({
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
      const matchedProducts = await Product.find({ productName: productMatch.productName }).select('code').lean();
      const codes = matchedProducts.map((p) => p.code).filter(Boolean);

      const currentQr = await getCurrentQrForCodes(codes);

      const primaryCode = currentQr?.code || codes[0] || productMatch.code;
      const { config, stages } = await resolveProductContext(primaryCode);
      const stageRows = await buildEmployeeStageRows({ codes, stages, employee: req.user });
      const firstAvailableStage = stageRows.find((stage) => Number(stage.availableCount || 0) > 0);
      const currentStageNumber = currentQr?.currentStage > 0
        ? currentQr.currentStage
        : firstAvailableStage?.stageNumber || stages[0]?.stageNumber || 1;
      const currentStage = getStageByNumber(stages, currentStageNumber);

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
        currentStage: currentStage.stageName,
        currentStageNumber
      },
      stage: currentStage,
      stages: await buildEmployeeStageRows({ codes: [code], stages, employee: req.user }),
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

      for (const r of responses || []) {
        const qKey = String(r?.questionId || r?.question || 'unknown');
        const type = String(r?.type || 'text').toLowerCase();

        if (type === 'count') {
          const optionKey = String(r?.optionKey || '').trim();
          if (!optionKey) continue;
          const countVal = Math.max(0, Number(r?.answer) || 0);
          if (optionKey === '__response__') {
            freeFormCountsByQuestion[qKey] = (freeFormCountsByQuestion[qKey] || 0) + countVal;
            continue;
          }
          if (!countsByQuestionOption[qKey]) countsByQuestionOption[qKey] = {};
          countsByQuestionOption[qKey][optionKey] = countVal;
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
          const c = Math.max(0, Number(countsForQ[opt]) || 0);
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

      return { overall, perQuestion };
    };

    const derivedRejected = deriveChoiceCountsFromResponses(rejectionFormResponses);
    const derivedRework = deriveChoiceCountsFromResponses(reworkFormResponses);

    const counts = {
      accepted: toCount(acceptedCount),
      rejected: derivedRejected.overall,
      rework: derivedRework.overall
    };

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
    const qrAvailableCount = qrCode?.quantity || await QRCode.countDocuments({ code, ...(batchNo ? { batchNo } : {}), currentStage: stageNumber });
    const availableCount = qrAvailableCount || await getAvailableCountForStage([code], stageNumber);
    if (total <= 0) return res.status(400).json({ message: 'Enter at least one processed item' });
    if (total > availableCount) return res.status(400).json({ message: 'Quantity breakdown cannot exceed available item count' });
    if ((counts.rejected > 0 || counts.rework > 0) && !String(remarks).trim()) {
      return res.status(400).json({ message: 'Remarks are required when rejected or rework items are present' });
    }

    const { product, stages } = await resolveProductContext(code);
    const stage = getStageByNumber(stages, stageNumber);

    // Update ProductStage counters based on submitted counts.
    // Keep QR logic only for trace/movement; ProductStage becomes source of truth for stage review stats.
    // NOTE: availableQuantity is expected to be initialized when ProductStage rows are created.
    // If not found, create it with sane defaults.
    const ProductStage = require('../models/ProductStage');

    const resolvedProductId = product?._id || productId;


    // Ensure ProductStage row exists for this product+stage
    const productStage = await ProductStage.findOneAndUpdate(
      {
        productId: resolvedProductId,
        code,
        stageNumber
      },
      {
        $setOnInsert: {
          productId: resolvedProductId,

          code,
          stageNumber,
          stageName: stage?.stageName || `Stage ${stageNumber}`,
          availableQuantity: availableCount,
          acceptedCount: 0,
          rejectedCount: 0,
          reworkCount: 0,
          pendingCount: availableCount
        }
      },
      { new: true, upsert: true }
    );

    // Recalculate pending based on counters.
    const nextAccepted = Number(productStage.acceptedCount || 0) + counts.accepted;
    const nextRejected = Number(productStage.rejectedCount || 0) + counts.rejected;
    const nextRework = Number(productStage.reworkCount || 0) + counts.rework;
    const nextPending = Math.max(Number(productStage.availableQuantity || availableCount || 0) - (nextAccepted + nextRejected + nextRework), 0);

    await ProductStage.updateOne(
      {
        _id: productStage._id
      },
      {
        $set: {
          acceptedCount: nextAccepted,
          rejectedCount: nextRejected,
          reworkCount: nextRework,
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
          inputQuantity: Number(productStage.availableQuantity || availableCount || total || 0),
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

    const qrsPool = await QRCode.find({
      code,
      ...(batchNo ? { batchNo } : {}),
      currentStage: stageNumber
    })
      .sort({ createdAt: 1 })
      .limit(total);

    const acceptedQrs = qrsPool.slice(0, counts.accepted);
    const rejectedQrs = qrsPool.slice(counts.accepted, counts.accepted + counts.rejected);
    const reworkQrs = qrsPool.slice(counts.accepted + counts.rejected, counts.accepted + counts.rejected + counts.rework);

    const operatorName = getEmployeeName(req.user);

    // Move accepted to next stage (if exists), else mark as accepted at current stage (final stage)
    if (acceptedQrs.length && nextStage) {
      // 1) Update QR codes to be processed at the next stage
      await QRCode.updateMany(
        { _id: { $in: acceptedQrs.map((q) => q._id) } },
        { $set: { currentStage: nextStage.stageNumber, status: 'processing' } }
      );

      // 2) Queue counters: accepted items are now *arrived for processing* in next stage,
      // but they should not be counted as 'accepted' at the next stage yet.
      await ProductStage.findOneAndUpdate(
        {
          productId: resolvedProductId,
          code,
          stageNumber: nextStage.stageNumber
        },
        {
          $setOnInsert: {
            productId: resolvedProductId,
            code,
            stageNumber: nextStage.stageNumber,
            stageName: nextStage.stageName || `Stage ${nextStage.stageNumber}`,
            availableQuantity: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            reworkCount: 0,
            pendingCount: 0
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
            inputQuantity: 0,
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


    res.json({
      success: true,
      logs: rows,
      rows,
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

      if (!qrCode) {
        return {
          ...response,
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



