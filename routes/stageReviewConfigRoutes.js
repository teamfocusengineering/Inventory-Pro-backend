const express = require("express");
const router = express.Router();

const controller = require(
  "../controllers/stageReviewConfigController"
);

router.post(
  "/:stageId",
  controller.createOrUpdateConfig
);

router.get(
  "/:stageId",
  controller.getConfig
);

router.post(
  "/submit/review",
  controller.submitReview
);

router.get(
  "/analytics/:stageId",
  controller.getAnalytics
);

module.exports = router;