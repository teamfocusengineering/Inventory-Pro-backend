const mongoose = require("mongoose");

const AnswerSchema = new mongoose.Schema({
  questionId: String,
  answer: mongoose.Schema.Types.Mixed
});

const StageReviewSubmissionSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product"
  },

  stageId: {
    type: String
  },

  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee"
  },

  status: {
    type: String,
    enum: [
      "accepted",
      "rework",
      "rejected"
    ]
  },

  answers: [AnswerSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model(
  "StageReviewSubmission",
  StageReviewSubmissionSchema
);
