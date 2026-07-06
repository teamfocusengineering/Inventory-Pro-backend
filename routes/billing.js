const express = require('express');
const router = express.Router();
const { auth, authAndEmployee } = require('../middleware/authMiddleware');
const billingController = require('../controllers/billingController');

// @route   POST /api/billing/checkout
// @desc    Create invoice and update stock
router.post('/checkout', auth, authAndEmployee, billingController.checkout);

// @route   GET /api/billing/invoices
// @desc    Get all invoices with optional date filter
router.get('/invoices', auth, authAndEmployee, billingController.getInvoices);

// @route   GET /api/billing/invoices/:id
// @desc    Get single invoice by ID
router.get('/invoices/:id', auth, authAndEmployee, billingController.getInvoiceById);

// @route   GET /api/billing/invoice-number/:invoiceNumber
// @desc    Get invoice by invoice number
router.get('/invoice-number/:invoiceNumber', auth, authAndEmployee, billingController.getInvoiceByNumber);

// @route   POST /api/billing/refund/:id
// @desc    Refund an invoice (reverse stock)
// @access  Admin only
router.post('/refund/:id', auth, billingController.refundInvoice);

// @route   GET /api/billing/invoices/:id/pdf
// @desc    Download invoice as PDF
// @access  Authenticated users
router.get('/invoices/:id/pdf', auth, billingController.downloadInvoicePDF);

module.exports = router;

