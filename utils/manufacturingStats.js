const ProcessingStage = require('../models/ProcessingStage');
const Product = require('../models/Product');
const ProductStage = require('../models/ProductStage');
const { syncStageOneInputQuantity } = require('./processingStageInventory');

const normalizecode = (code) => String(code || '').trim();

// Stage-queue model:
// Stage N "accepted" should represent items that were accepted in Stage N-1 and routed forward.
// We approximate this by summing acceptedQuantity from ProcessingStage documents of stage (N-1).
const getForwardedAcceptedForStage = async ({ code, stageNum }) => {
  if (!Number.isFinite(stageNum) || stageNum <= 1) return 0;

  const [row = {}] = await ProcessingStage.aggregate([
    {
      $match: {
        code,
        stageNumber: stageNum - 1,
        $or: [{ qrId: { $exists: false } }, { qrId: null }]
      }
    },
    {
      $group: {
        _id: null,
        acceptedFromPrev: { $sum: '$acceptedQuantity' }
      }
    }
  ]);

  return Number(row.acceptedFromPrev || 0);
};

const parseStageNumber = (stageNumber) => {
  const exact = Number(stageNumber);
  if (Number.isFinite(exact) && exact > 0) return exact;

  const suffixMatch = String(stageNumber || '').match(/-(\d+)$/);
  const suffix = suffixMatch ? Number(suffixMatch[1]) : NaN;
  return Number.isFinite(suffix) && suffix > 0 ? suffix : null;
};

const getProductIdealInventory = async (code) => {
  const normalizedcode = normalizecode(code);
  const uppercode = normalizedcode.toUpperCase();

  const product = await Product.findOne({
    $or: [
      { code: normalizedcode },
      { code: uppercode },
      { code: normalizedcode },
      { code: uppercode },
      { productName: normalizedcode }
    ]
  }).lean();

  const idealCount = Number(product?.numberOfItems || product?.stockQuantity || 0);
  return {
    product,
    idealCount: Number.isFinite(idealCount) && idealCount > 0 ? idealCount : 0
  };
};

/**
 * Manufacturing stats source of truth
 * Use ONLY ProcessingStage quantities. Product creation syncs Product.numberOfItems
 * into stage 1 inputQuantity, so analytics never depend on QR generation.
 */
const getManufacturingStatsByCode = async ({ code, stageNumber }) => {
  const normalizedcode = normalizecode(code);

  if (!normalizedcode) {
    return {
      code: '',
      stageNumber: stageNumber ? Number(stageNumber) : null,
      totalItems: 0,
      accepted: 0,
      rejected: 0,
      rework: 0,
      pending: 0
    };
  }

  const stageNum =
    stageNumber !== undefined && stageNumber !== null && stageNumber !== ''
      ? parseStageNumber(stageNumber)
      : null;

  // Stage mode
  if (stageNum) {
    const [productStageRow = {}] = await ProductStage.aggregate([
      {
        $match: {
          code: normalizedcode,
          stageNumber: stageNum
        }
      },
      {
        $group: {
          _id: '$stageNumber',
          totalInput: { $sum: '$availableQuantity' },
          accepted: { $sum: '$acceptedCount' },
          rejected: { $sum: '$rejectedCount' },
          rework: { $sum: '$reworkCount' }
        }
      }
    ]);

    if (productStageRow.totalInput !== undefined) {
      const totalItems = Number(productStageRow.totalInput || 0);
      const accepted = Number(productStageRow.accepted || 0);
      const rejected = Number(productStageRow.rejected || 0);
      const rework = Number(productStageRow.rework || 0);

      return {
        code: normalizedcode,
        stageNumber: stageNum,
        totalItems,
        inputQuantity: totalItems,
        accepted,
        rejected,
        rework,
        pending: Math.max(totalItems - (accepted + rejected + rework), 0)
      };
    }

    const [row = {}] = await ProcessingStage.aggregate([
      {
        $match: {
          code: normalizedcode,
          stageNumber: stageNum,
          $or: [{ qrId: { $exists: false } }, { qrId: null }]
        }
      },
      {
        $group: {
          _id: '$stageNumber',
          totalInput: { $sum: '$inputQuantity' },
          accepted: { $sum: '$acceptedQuantity' },
          rejected: { $sum: '$rejectedQuantity' },
          rework: { $sum: '$reworkQuantity' }
        }
      }
    ]);

    const totalInput = Number(row.totalInput || 0);
    let idealProductCount = 0;

    // If this is not the first stage, derive the stage queue using the previous stage accepted quantity.
    // This fixes the case where Stage-1 accepted items should appear as "accepted" in Stage-2 stats.
    let forwardedAccepted = 0;
    if (stageNum > 1) {
      const forwarded = await getForwardedAcceptedForStage({ code: normalizedcode, stageNum });
      forwardedAccepted = forwarded;
    }


    if (stageNum === 1 && totalInput === 0) {
      const { product, idealCount } = await getProductIdealInventory(normalizedcode);
      idealProductCount = idealCount;

      if (product && idealCount > 0) {
        await syncStageOneInputQuantity(product);
      }
    } else if (stageNum > 1 && totalInput === 0 && forwardedAccepted > 0) {
      // If stage rows don't exist yet, but previous stage accepted exists,
      // ensure stage queue shows correct totals.
      idealProductCount = forwardedAccepted;
    }


    const totalItems = totalInput || idealProductCount;

    // IMPORTANT:
    // Stage N+1 "accepted" must ONLY represent items accepted AFTER Stage N+1 review.
    // Forwarded accepted from previous stage contributes to total/input queue,
    // but should not inflate accepted count for this stage until this stage is reviewed.
    const accepted = Number(row.accepted || 0);
    const rejected = Number(row.rejected || 0);
    const rework = Number(row.rework || 0);



    return {
      code: normalizedcode,
      stageNumber: stageNum,
      totalItems,
      inputQuantity: totalItems,
      accepted,
      rejected,
      rework,
      pending: Math.max(totalItems - (accepted + rejected + rework), 0)
    };
  }


  // Overall mode
  // NOTE: Manufacturing analytics should not depend on QRCode collection counts.
  // We aggregate ONLY from ProcessingStage.inputQuantity/counters.
  const [totals] = await ProcessingStage.aggregate([
    {
      $match: { code: normalizedcode }
    },
    {
      $group: {
        _id: null,
        totalInput: { $sum: '$inputQuantity' },
        accepted: { $sum: '$acceptedQuantity' },
        rejected: { $sum: '$rejectedQuantity' },
        rework: { $sum: '$reworkQuantity' }
      }
    }
  ]);

  const row = totals || {};
  const totalItems = Number(row.totalInput || 0);
  const accepted = Number(row.accepted || 0);
  const rejected = Number(row.rejected || 0);
  const rework = Number(row.rework || 0);
  const pending = Math.max(totalItems - (accepted + rejected + rework), 0);

  return {
    code: normalizedcode,
    stageNumber: null,
    totalItems,
    inputQuantity: totalItems,
    accepted,
    rejected,
    rework,
    pending
  };
};

module.exports = {
  getManufacturingStatsByCode
};



