const mongoose = require('mongoose');
const RefundRequest = require('../models/RefundRequest');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Notification = require('../models/Notification');

// Create a new refund request
exports.createRefundRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { invoiceId, reason } = req.body;

    if (!invoiceId || !reason) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invoice ID and reason are required' });
    }

    // Find the invoice
    const invoice = await Invoice.findById(invoiceId).session(session);
    
    if (!invoice) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.status === 'refunded') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invoice already refunded' });
    }

    // Check if there's already a pending refund request for this invoice
    const existingRequest = await RefundRequest.findOne({
      invoiceId: invoiceId,
      status: 'pending'
    }).session(session);

    if (existingRequest) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'A refund request already exists for this invoice' });
    }

    // Create refund request
    const refundRequest = new RefundRequest({
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: req.user._id,
      customerName: invoice.customerName,
      items: invoice.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        code: item.code,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        total: item.total
      })),
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      totalAmount: invoice.totalAmount,
      reason: reason,
      status: 'pending'
    });

    await refundRequest.save({ session });

    // Send notification to customer - refund request created
    await Notification.create([{
      recipient: req.user._id,
      sender: req.user._id,
      type: 'refund_approved',
      title: 'Refund Request Submitted',
      message: `Your refund request for invoice ${refundRequest.invoiceNumber} has been submitted and is pending review.`,
      relatedId: refundRequest._id,
      relatedModel: 'RefundRequest'
    }]);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Refund request submitted successfully',
      refundRequest
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Refund request error:', error);
    res.status(500).json({ message: error.message || 'Failed to create refund request' });
  }
};

// Get all refund requests (admin) or user's own requests
exports.getRefundRequests = async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};

    // If not admin, only show their own requests
    if (req.user.role !== 'admin') {
      query.customerId = req.user._id;
    }

    if (status) {
      query.status = status;
    }

    const refundRequests = await RefundRequest.find(query)
      .populate('customerId', 'username email')
      .populate('processedBy', 'username')
      .sort({ createdAt: -1 });

    res.json(refundRequests);
  } catch (error) {
    console.error('Fetch refund requests error:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch refund requests' });
  }
};

// Get current user's refund requests
exports.getMyRefundRequests = async (req, res) => {
  try {
    const refundRequests = await RefundRequest.find({ customerId: req.user._id })
      .populate('processedBy', 'username')
      .sort({ createdAt: -1 });

    res.json(refundRequests);
  } catch (error) {
    console.error('Fetch my refund requests error:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch refund requests' });
  }
};

// Approve refund request and restore stock
exports.approveRefundRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const refundRequest = await RefundRequest.findById(req.params.id).session(session);

    if (!refundRequest) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Refund request not found' });
    }

    if (refundRequest.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Refund request is already processed' });
    }

    // Restore stock for each item
    for (const item of refundRequest.items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stockQuantity: item.quantity } },
        { session }
      );
    }

    // Update the invoice status to refunded
    await Invoice.findByIdAndUpdate(
      refundRequest.invoiceId,
      { status: 'refunded' },
      { session }
    );

    // Update refund request status
    refundRequest.status = 'approved';
    refundRequest.adminResponse = 'Your refund has been approved. The amount will be credited to your account.';
    refundRequest.processedBy = req.user._id;
    refundRequest.processedAt = new Date();

    await refundRequest.save({ session });

    // Send notification to customer - refund approved
    await Notification.create([{
      recipient: refundRequest.customerId,
      sender: req.user._id,
      type: 'refund_approved',
      title: 'Refund Approved',
      message: `Your refund request for invoice ${refundRequest.invoiceNumber} has been approved. ${refundRequest.adminResponse}`,
      relatedId: refundRequest._id,
      relatedModel: 'RefundRequest'
    }]);

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: 'Refund request approved successfully',
      refundRequest
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Approve refund request error:', error);
    res.status(500).json({ message: error.message || 'Failed to approve refund request' });
  }
};

// Reject refund request
exports.rejectRefundRequest = async (req, res) => {
  try {
    const { reason } = req.body;

    const refundRequest = await RefundRequest.findById(req.params.id);

    if (!refundRequest) {
      return res.status(404).json({ message: 'Refund request not found' });
    }

    if (refundRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Refund request is already processed' });
    }

    refundRequest.status = 'rejected';
    refundRequest.adminResponse = reason || 'Your refund request has been rejected.';
    refundRequest.processedBy = req.user._id;
    refundRequest.processedAt = new Date();

    await refundRequest.save();

    res.json({
      message: 'Refund request rejected',
      refundRequest
    });
  } catch (error) {
    console.error('Reject refund request error:', error);
    res.status(500).json({ message: error.message || 'Failed to reject refund request' });
  }
};

// Get count of pending refund requests
exports.getPendingCount = async (req, res) => {
  try {
    const count = await RefundRequest.countDocuments({ status: 'pending' });
    res.json({ count });
  } catch (error) {
    console.error('Fetch pending count error:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch pending count' });
  }
};



