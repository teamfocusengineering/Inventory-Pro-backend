const StageReviewConfig = require("../models/StageReviewConfig");
const StageReviewSubmission = require("../models/StageReviewSubmission");
const { getManufacturingStatsByCode } = require("../utils/manufacturingStats");

const parseStageNumber = (stageId) => {
  // Accept stageId shapes like:
  //  - "1" / 1
  //  - "stage-1" / "Stage-1" / "S1" / "S-1"
  //  - "something-2" (suffix digits)
  //  - "1-stage" (prefix digits)
  // Return null if stage number cannot be inferred.
  const raw = stageId === undefined || stageId === null ? '' : String(stageId).trim();
  if (!raw) return null;

  const exact = Number(raw);
  if (Number.isFinite(exact) && exact > 0) return exact;

  // suffix digits: "something-2" or "stage-2"
  const suffixMatch = raw.match(/-(\d+)$/);
  const suffix = suffixMatch ? Number(suffixMatch[1]) : NaN;
  if (Number.isFinite(suffix) && suffix > 0) return suffix;

  // prefix digits: "2-stage" (rare but handle)
  const prefixMatch = raw.match(/^(\d+)[^\d]*$/) || raw.match(/^(\d+)(?=[^\d]*$)/);
  if (prefixMatch) {
    const prefix = Number(prefixMatch[1]);
    if (Number.isFinite(prefix) && prefix > 0) return prefix;
  }

  // handle "S1" / "S-1" / "STAGE1"
  const sMatch = raw.match(/\bS\s*[-]?(\d+)\b/i) || raw.match(/\bSTAGE\s*[-]?(\d+)\b/i);
  const sNum = sMatch ? Number(sMatch[1]) : NaN;
  if (Number.isFinite(sNum) && sNum > 0) return sNum;

  return null;
};

exports.createOrUpdateConfig = async (req, res) => {
  try {
    const { stageId } = req.params;

    const {
      acceptedRouteStage,
      reworkRouteStage,
      rejectionQuestionnaireEnabled,
      rejectionQuestions,
      reworkQuestionnaireEnabled,
      reworkQuestions
    } = req.body;

    const config = await StageReviewConfig.findOneAndUpdate(
      { stageId },
      {
        stageId,
        acceptedRouteStage: acceptedRouteStage || "",
        reworkRouteStage: reworkRouteStage || "",
        rejectionQuestionnaireEnabled: Boolean(rejectionQuestionnaireEnabled),
        rejectionQuestions: Array.isArray(rejectionQuestions) ? rejectionQuestions : [],
        reworkQuestionnaireEnabled: Boolean(reworkQuestionnaireEnabled),
        reworkQuestions: Array.isArray(reworkQuestions) ? reworkQuestions : []
      },
      {
        new: true,
        upsert: true
      }
    );

    res.status(200).json({
      success: true,
      data: config
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getConfig = async (req, res) => {
  try {
    const { stageId } = req.params;

    const config = await StageReviewConfig.findOne({
      stageId
    });

    res.status(200).json({
      success: true,
      data: config
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.submitReview = async (req, res) => {
  try {
    const submission = await StageReviewSubmission.create(req.body);

    res.status(201).json({
      success: true,
      data: submission
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Stage review analytics should reflect the queue model (accepted items forwarded into later stages
// should contribute as input/pending there). We already use getManufacturingStatsByCode from manufacturingStats.js,
// so no change is required here.
exports.getAnalytics = async (req, res) => {
  try {
    const { stageId } = req.params;
    const { code } = req.query;

    if (code) {
      const parsedStageNumber = parseStageNumber(stageId);
      if (!parsedStageNumber) {
        return res.status(400).json({
          success: false,
          message: `Invalid stageId. Could not parse stage number from: ${stageId}`
        });
      }

      const stats = await getManufacturingStatsByCode({
        code,
        stageNumber: parsedStageNumber
      });

      return res.status(200).json({
        success: true,
        data: {
          total: stats.totalItems,
          totalItems: stats.totalItems,
          accepted: stats.accepted,
          rejected: stats.rejected,
          rework: stats.rework,
          pending: stats.pending
        }
      });
    }

    const submissions = await StageReviewSubmission.find({
      stageId
    });

    const total = submissions.length;

    const accepted = submissions.filter(
      s => s.status === "accepted"
    ).length;

    const rejected = submissions.filter(
      s => s.status === "rejected"
    ).length;

    const rework = submissions.filter(
      s => s.status === "rework"
    ).length;

    res.status(200).json({
      success: true,
      data: {
        total,
        accepted,
        rejected,
        rework,
        acceptedPercentage:
          total > 0 ? (accepted / total) * 100 : 0,

        rejectedPercentage:
          total > 0 ? (rejected / total) * 100 : 0,

        reworkPercentage:
          total > 0 ? (rework / total) * 100 : 0
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};



