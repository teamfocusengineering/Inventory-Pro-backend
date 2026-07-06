const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'model', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const chatSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  messages: [chatMessageSchema],
  title: {
    type: String,
    default: 'New Chat'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for performance
chatSessionSchema.index({ userId: 1, updatedAt: -1 });
chatSessionSchema.index({ 'messages.timestamp': -1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);

