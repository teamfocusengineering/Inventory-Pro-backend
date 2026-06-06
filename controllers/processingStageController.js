const ProcessingStage = require('../models/ProcessingStage');
const QRCode = require('../models/QRCode');
const { getManufacturingStatsByCode } = require('../utils/manufacturingStats');

exports.getAllProcessingStages = async (req, res) => {
  try {
    const { search, code, stageNumber, status, qrId } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { stageName: { $regex: search, $options: 'i' } }
      ];
    }

    if (code) query.code = code;
    if (qrId) query.qrId = qrId;
    if (stageNumber) query.stageNumber = parseInt(stageNumber);
    if (status) query.status = status;

    const stages = await ProcessingStage.find(query)
      .populate('qrId', 'qrId code')
      .sort({ createdAt: -1 });
    
    res.json(stages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProcessingStageById = async (req, res) => {
  try {
    const stage = await ProcessingStage.findById(req.params.id)
      .populate('qrId', 'qrId code');
    
    if (!stage) {
      return res.status(404).json({ message: 'Processing stage not found' });
    }
    res.json(stage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createProcessingStage = async (req, res) => {
  try {
    const { qrId, code, stageNumber, stageName, inputQuantity, operator } = req.body;

    const existingStage = qrId
      ? await ProcessingStage.findOne({ qrId, stageNumber })
      : await ProcessingStage.findOne({ code, stageNumber, qrId: { $exists: false } });
    if (existingStage) {
      return res.status(400).json({ message: 'Processing stage already exists for this QR code' });
    }

    const stage = new ProcessingStage({
      qrId,
      code,
      stageNumber,
      stageName,
      inputQuantity,
      operator,
      status: 'pending'
    });

    await stage.save();

    if (qrId) {
      await QRCode.findByIdAndUpdate(qrId, {
        status: 'processing'
      });
    }

    const populated = await ProcessingStage.findById(stage._id).populate('qrId', 'qrId');
    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateProcessingStage = async (req, res) => {
  try {
    const stage = await ProcessingStage.findById(req.params.id);
    if (!stage) {
      return res.status(404).json({ message: 'Processing stage not found' });
    }

    const { outputQuantity, operator, validated, validatedBy, validationRemarks, status } = req.body;

    if (outputQuantity !== undefined) stage.outputQuantity = outputQuantity;
    if (operator !== undefined) stage.operator = operator;
    if (validated !== undefined) stage.validated = validated;
    if (validatedBy !== undefined) stage.validatedBy = validatedBy;
    if (validationRemarks !== undefined) stage.validationRemarks = validationRemarks;
    if (status) stage.status = status;

    if (stage.outputQuantity > 0 && !stage.processedAt) {
      stage.processedAt = new Date();
    }

    await stage.save();
    res.json(stage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.completeProcessingStage = async (req, res) => {
  try {
    const stage = await ProcessingStage.findById(req.params.id);
    if (!stage) {
      return res.status(404).json({ message: 'Processing stage not found' });
    }

    stage.status = 'completed';
    stage.processedAt = new Date();

    await stage.save();

    if (stage.qrId) {
      await QRCode.findByIdAndUpdate(stage.qrId, {
        status: 'completed',
        currentStage: stage.stageNumber
      });
    }

    res.json(stage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.validateProcessingStage = async (req, res) => {
  try {
    const stage = await ProcessingStage.findById(req.params.id);
    if (!stage) {
      return res.status(404).json({ message: 'Processing stage not found' });
    }

    const { validated, validatedBy, remarks } = req.body;

    stage.validated = validated;
    stage.validatedBy = validatedBy;
    stage.validationRemarks = remarks;

    if (validated) {
      stage.status = 'validated';
    }

    await stage.save();
    res.json(stage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: stage-level review statistics
exports.getStageReviewStats = async (req, res) => {
  try {
    const stageNumber = parseInt(req.params.stageNumber);
    const { code } = req.query;

    if (code) {
      const stats = await getManufacturingStatsByCode({ code, stageNumber });

      // Backward compatible field names for existing frontend components
      return res.json({
        ...stats,
        total: stats.totalItems,
        acceptedCount: stats.accepted,
        rejectedCount: stats.rejected,
        reworkCount: stats.rework,
        pendingCount: stats.pending
      });
    }

    const agg = await ProcessingStage.aggregate([
      {
        $match: { stageNumber }
      },
      {
        $group: {
          _id: null,
          acceptedCount: { $sum: '$acceptedQuantity' },
          rejectedCount: { $sum: '$rejectedQuantity' },
          reworkCount: { $sum: '$reworkQuantity' },
          total: { $sum: '$inputQuantity' }
        }
      }
    ]);

    const row = agg[0] || { acceptedCount: 0, rejectedCount: 0, reworkCount: 0, total: 0 };
    row.pendingCount = Math.max(
      Number(row.total || 0) - (Number(row.acceptedCount || 0) + Number(row.rejectedCount || 0) + Number(row.reworkCount || 0)),
      0
    );
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: list all product rows for a stage (used in the stage details table)
exports.getStageReviewItems = async (req, res) => {
  try {
    const stageNumber = parseInt(req.params.stageNumber);

    const items = await ProcessingStage.find({ stageNumber })
      .populate('qrId', 'qrId code')
      .sort({ updatedAt: -1 });

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: update a single product row review status
exports.updateStageReview = async (req, res) => {
  try {
    const stage = await ProcessingStage.findById(req.params.id);
    if (!stage) {
      return res.status(404).json({ message: 'Processing stage not found' });
    }

    const { reviewStatus, rejectionReason, operator, reviewAnswers, reviewFormVersion } = req.body;


    if (!['accepted', 'rejected', 'pending', 'rework'].includes(reviewStatus)) {
      return res.status(400).json({ message: 'Invalid reviewStatus' });
    }


    if (reviewStatus === 'rejected') {
      if (!rejectionReason || String(rejectionReason).trim().length === 0) {
        return res.status(400).json({ message: 'rejectionReason is required when reviewStatus is rejected' });
      }
      stage.rejectionReason = String(rejectionReason).trim();
    } else {
      // accepted / pending / rework
      stage.rejectionReason = '';
    }

    stage.reviewStatus = reviewStatus;
    stage.acceptedQuantity = reviewStatus === 'accepted' ? Number(stage.inputQuantity || 0) : 0;
    stage.rejectedQuantity = reviewStatus === 'rejected' ? Number(stage.inputQuantity || 0) : 0;
    stage.reworkQuantity = reviewStatus === 'rework' ? Number(stage.inputQuantity || 0) : 0;
    if (operator !== undefined) stage.validatedBy = operator;

    if (reviewAnswers !== undefined) stage.reviewAnswers = reviewAnswers;
    if (reviewFormVersion !== undefined) stage.reviewFormVersion = reviewFormVersion;

    // If switching away from rejected, clear legacy rejectionReason
    if (stage.reviewStatus !== 'rejected') {
      stage.rejectionReason = '';
    }

    await stage.save();
    res.json(stage);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getStageStats = async (req, res) => {
  try {
    const stats = await ProcessingStage.aggregate([
      {
        $group: {
          _id: '$stageNumber',
          totalInput: { $sum: '$inputQuantity' },
          accepted: { $sum: '$acceptedQuantity' },
          rejected: { $sum: '$rejectedQuantity' },
          rework: { $sum: '$reworkQuantity' },
          totalOutput: { $sum: '$outputQuantity' },
          count: { $sum: '$inputQuantity' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



