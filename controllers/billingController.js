const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');
const User = require('../models/User');

// @desc    Create invoice and update stock
// @route   POST /api/billing/checkout
exports.checkout = async (req, res) => {
  try {
    const { items, customerName, paymentMethod, tax = 0, referredEmployee } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items in cart' });
    }

    if (!referredEmployee) {
      return res.status(400).json({ message: 'Referred employee is required' });
    }

    // 1. Validate stock for all items and prepare updates
    const stockUpdates = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await Product.findById(item.productId);
      
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.productId}` });
      }

      if (product.stockQuantity < item.quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${product.productName}. Available: ${product.stockQuantity}, Requested: ${item.quantity}`
        });
      }

      const itemTotal = product.sellingPrice * item.quantity;
      subtotal += itemTotal;

      stockUpdates.push({
        productId: product._id,
        productName: product.productName,
        code: product.code,
        quantity: item.quantity,
        sellingPrice: product.sellingPrice,
        total: itemTotal
      });
    }

    // 2. Deduct stock and check for low stock
    const lowStockProducts = [];
    for (const item of items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stockQuantity: -item.quantity } }
      );
      
      // Check if product is now low on stock
      const updatedProduct = await Product.findById(item.productId);
      if (updatedProduct && updatedProduct.stockQuantity <= updatedProduct.minStockLevel) {
        lowStockProducts.push(updatedProduct);
      }
    }

    // 3. Create invoice
    const totalAmount = subtotal + tax;
    const invoice = new Invoice({
      invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      items: stockUpdates,
      customerName: customerName || 'Walk-in Customer',
      subtotal,
      tax,
      totalAmount,
      paymentMethod: paymentMethod || 'cash',
      cashier: req.user._id,
      referredEmployee,
      status: 'completed'
    });

    await invoice.save();

    // Increment referred employee's sales count
    await User.findByIdAndUpdate(referredEmployee, { $inc: { salesCount: 1 } });

    // 4. Send low stock notifications to admins
    if (lowStockProducts.length > 0) {
      try {
        // Find all admins
        const admins = await User.find({ role: 'admin' });
        
        if (admins.length > 0) {
          await Notification.create(
            lowStockProducts.map(product => ({
              recipient: admins[0]._id, // Send to the first admin (or could iterate)
              sender: req.user._id,
              type: 'low_stock',
              title: 'Low Stock Alert',
              message: `${product.productName} (${product.code}) is running low. Current stock: ${product.stockQuantity}, Minimum: ${product.minStockLevel}`,
              relatedId: product._id,
              relatedModel: 'Product'
            }))
          );
          
          // If there are multiple admins, notify them too
          for (let i = 1; i < admins.length; i++) {
            await Notification.create(
              lowStockProducts.map(product => ({
                recipient: admins[i]._id,
                sender: req.user._id,
                type: 'low_stock',
                title: 'Low Stock Alert',
                message: `${product.productName} (${product.code}) is running low. Current stock: ${product.stockQuantity}, Minimum: ${product.minStockLevel}`,
                relatedId: product._id,
                relatedModel: 'Product'
              }))
            );
          }
        }
      } catch (notifError) {
        console.error('Failed to send low stock notification:', notifError);
      }
    }

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice,
      stockUpdated: true
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ message: error.message || 'Checkout failed' });
  }
};

// @desc    Get all invoices with optional date filter
// @route   GET /api/billing/invoices
exports.getInvoices = async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    
    let query = {};
    
    // Filter based on user role
    if (req.user.role === 'employee') {
      // Employees see invoices where they are the referred employee
      query.referredEmployee = req.user._id;
    }
    // Admin sees all invoices (no filter)

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const invoices = await Invoice.find(query)
      .populate('cashier', 'name')
      .populate('referredEmployee', 'name')
      .populate({ path: 'items.productId', populate: { path: 'category', select: 'name' } })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// @desc    Get single invoice by ID
// @route   GET /api/billing/invoices/:id
exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('cashier', 'name')
      .populate('referredEmployee', 'name')
      .populate({ path: 'items.productId', populate: { path: 'category', select: 'name' } });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get invoice by invoice number
// @route   GET /api/billing/invoice-number/:invoiceNumber
exports.getInvoiceByNumber = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber })
      .populate('cashier', 'name')
      .populate('referredEmployee', 'name')
      .populate({ path: 'items.productId', populate: { path: 'category', select: 'name' } });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Refund an invoice (reverse stock)
// @route   POST /api/billing/refund/:id
exports.refundInvoice = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoice = await Invoice.findById(req.params.id).session(session);
    
    if (!invoice) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.status === 'refunded') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invoice already refunded' });
    }

    // Restore stock for each item
    for (const item of invoice.items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stockQuantity: item.quantity } },
        { session }
      );
    }

    // Update invoice status
    invoice.status = 'refunded';
    await invoice.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Invoice refunded successfully', invoice });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: error.message });
  }
};

// @desc    Download invoice as PDF
// @route   GET /api/billing/invoices/:id/pdf
exports.downloadInvoicePDF = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('cashier', 'name')
      .populate({ path: 'items.productId', populate: { path: 'category', select: 'name' } });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Prepare invoice data for QR code (table format text)
    const formatCurrency = (value) => `₹${(value || 0).toFixed(2)}`;
    
    // Build table format string for QR code
    let qrTableData = `INVOICE DETAILS\n`;
    qrTableData += `====================\n`;
    qrTableData += `Invoice No : ${invoice.invoiceNumber}\n`;
    qrTableData += `Date       : ${new Date(invoice.createdAt).toLocaleDateString('en-IN')}\n`;
    qrTableData += `Customer   : ${invoice.customerName || 'Walk-in Customer'}\n`;
    qrTableData += `Cashier    : ${invoice.cashier?.name || 'Unknown'}\n`;
    qrTableData += `Payment    : ${invoice.paymentMethod.charAt(0).toUpperCase() + invoice.paymentMethod.slice(1)}\n`;
    qrTableData += `Status     : ${invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}\n`;
    qrTableData += `====================\n`;
    qrTableData += `ITEMS:\n`;
    qrTableData += `--------------------\n`;
    qrTableData += `Code    | Qty | Price    | Total\n`;
    qrTableData += `--------------------\n`;
    
    invoice.items.forEach(item => {
      const code = (item.code || '-').substring(0, 6).padEnd(6);
      const qty = item.quantity.toString().padEnd(3);
      const price = formatCurrency(item.sellingPrice).padEnd(9);
      const total = formatCurrency(item.total);
      qrTableData += `${code} | ${qty} | ${price} | ${total}\n`;
    });
    
    qrTableData += `====================\n`;
    qrTableData += `Subtotal   : ${formatCurrency(invoice.subtotal)}\n`;
    qrTableData += `Tax        : ${formatCurrency(invoice.tax)}\n`;
    qrTableData += `====================\n`;
    qrTableData += `TOTAL      : ${formatCurrency(invoice.totalAmount)}\n`;
    qrTableData += `====================\n`;
    qrTableData += `Focus Engineering\n`;
    qrTableData += `Thank You!`;
    
    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(qrTableData, {
      width: 150,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    
    // Pipe the PDF to the response
    doc.pipe(res);

    // Header - Company Name
    doc.fontSize(24).font('Helvetica-Bold').text('Focus Engineering', { align: 'center' });
    doc.moveDown(0.5);
    
    // Invoice Number
    doc.fontSize(14).font('Helvetica').text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'center' });
    doc.moveDown(0.5);
    
    // Date
    doc.fontSize(10).text(`Date: ${new Date(invoice.createdAt).toLocaleDateString('en-IN', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`, { align: 'center' });
    
    doc.moveDown(1);

    // Status Badge
    const statusColor = invoice.status === 'completed' ? '#22c55e' : '#ef4444';
    doc.fillColor(statusColor)
       .fontSize(12)
       .text(invoice.status.toUpperCase(), { align: 'center' });
    
    doc.fillColor('#000000');
    doc.moveDown(1);

    // Customer & Cashier Info
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text('Bill To:');
    doc.font('Helvetica').text(invoice.customerName || 'Walk-in Customer');
    doc.moveDown(0.5);
    
    doc.font('Helvetica-Bold').text('Cashier:').text(invoice.cashier?.name || "Unknown");
    
    doc.moveDown(0.5);
    
    doc.font('Helvetica-Bold').text('Payment Method:');
    doc.font('Helvetica').text(invoice.paymentMethod.charAt(0).toUpperCase() + invoice.paymentMethod.slice(1));
    
    doc.moveDown(1);

    // Items Table Header
    const tableTop = doc.y;
    const itemCodeX = 50;
    const itemNameX = 120;
    const qtyX = 300;
    const priceX = 360;
    const totalX = 440;
    const tableWidth = 495;

    // Table header background
    doc.fillColor('#f3f4f6')
       .rect(50, tableTop, tableWidth, 25)
       .fill();

    doc.fillColor('#000000')
       .fontSize(10)
       .font('Helvetica-Bold');

    doc.text('Code', itemCodeX, tableTop + 8);
    doc.text('Product', itemNameX, tableTop + 8);
    doc.text('Qty', qtyX, tableTop + 8, { width: 50, align: 'center' });
    doc.text('Price', priceX, tableTop + 8, { width: 70, align: 'right' });
    doc.text('Total', totalX, tableTop + 8, { width: 70, align: 'right' });

    // Table rows
    let y = tableTop + 30;
    
    doc.font('Helvetica').fontSize(9);
    
    invoice.items.forEach((item, index) => {
      // Alternate row background
      if (index % 2 === 0) {
        doc.fillColor('#f9fafb')
           .rect(50, y - 5, tableWidth, 20)
           .fill();
        doc.fillColor('#000000');
      }
      
      doc.text(item.code || '-', itemCodeX, y);
      doc.text(item.productName || 'Unknown Product', itemNameX, y, { width: 170 });
      doc.text(item.quantity.toString(), qtyX, y, { width: 50, align: 'center' });
      doc.text(`₹${item.sellingPrice.toFixed(2)}`, priceX, y, { width: 70, align: 'right' });
      doc.text(`₹${item.total.toFixed(2)}`, totalX, y, { width: 70, align: 'right' });
      
      y += 20;
    });

    // Totals Section
    y += 20;
    doc.fontSize(11);
    
    // Subtotal
    doc.font('Helvetica');
    doc.text('Subtotal:', 350, y, { width: 90, align: 'right' });
    doc.text(`₹${invoice.subtotal.toFixed(2)}`, 440, y, { width: 70, align: 'right' });
    
    y += 20;
    
    // Tax
    doc.text('Tax:', 350, y, { width: 90, align: 'right' });
    doc.text(`₹${invoice.tax.toFixed(2)}`, 440, y, { width: 70, align: 'right' });
    
    y += 25;
    
    // Total (bold)
    doc.font('Helvetica-Bold').fontSize(14);
    doc.text('TOTAL:', 350, y, { width: 90, align: 'right' });
    doc.text(`₹${invoice.totalAmount.toFixed(2)}`, 440, y, { width: 70, align: 'right' });

    // Add QR Code to PDF (Right Side)
    y += 30;
    
    // QR Code Section - Right Side
    doc.fontSize(10).font('Helvetica-Bold').text('Scan for Digital Copy:', 50, y);
    doc.moveDown(0.5);
    
    // Add QR code image from data URL - positioned on the right
    const qrBuffer = Buffer.from(qrCodeDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    doc.image(qrBuffer, 50, y + 10, { width: 100, height: 100 });

    // Footer
    doc.fontSize(9).font('Helvetica');
    doc.text('Thank you for your business!', 50, doc.page.height - 100, { align: 'center' });

    // Finalize PDF
    doc.end();
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ message: 'Failed to generate PDF' });
  }
};



