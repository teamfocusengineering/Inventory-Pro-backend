const mongoose = require("mongoose");

const QuestionOptionSchema = new mongoose.Schema({
  optionId: {
    type: String
  },

  label: {
    type: String,
    default: ""
  },

  value: {
    type: String,
    default: ""
  },

  subQuestions: []
});

const ReviewQuestionSchema = new mongoose.Schema({
  questionId: {
    type: String,
    required: true
  },

  questionText: {
    type: String,
    default: ""
  },

  responseType: {
    type: String,
    enum: [
      "text",
      "dropdown",
      "radio",
      "checkbox"
    ],
    required: true
  },

  required: {
    type: Boolean,
    default: false
  },

  options: [QuestionOptionSchema]
});

const StageReviewConfigSchema = new mongoose.Schema({
  stageId: {
    type: String,
    required: true
  },

  acceptedRouteStage: {
    type: String,
    default: ""
  },

  reworkRouteStage: {
    type: String,
    default: ""
  },

  rejectionQuestionnaireEnabled: {
    type: Boolean,
    default: false
  },

  rejectionQuestions: [ReviewQuestionSchema],

  reworkQuestionnaireEnabled: {
    type: Boolean,
    default: false
  },

  reworkQuestions: [ReviewQuestionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model(
  "StageReviewConfig",
  StageReviewConfigSchema
);
