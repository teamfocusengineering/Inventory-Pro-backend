const express = require('express');
const router = express.Router();
const ChatSession = require('../models/ChatSession');
const authMiddleware = require('../middleware/authMiddleware');
const protect = authMiddleware.protect || authMiddleware.auth;

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-1.5-flash';

// Simple rate limiter (in production use redis)
const rateLimit = new Map();

const SYSTEM_PROMPT = `You are an AI assistant for Inventory PRO inventory management system. Help with:
 - Product/inventory management
 - Billing & invoices  
 - Employees
 - Refunds & reports
 - System usage

Keep responses concise, helpful. Current date: ${new Date().toLocaleDateString()}.`;

router.post('/chat', protect, async (req, res) => {
  try {
    const userId = req.user.id; // From JWT
    const { message } = req.body;

    // Rate limit: 10 req/min per user
    const now = Date.now();
    const userKey = `chat:${userId}`;
    const window = 60 * 1000;
    const limit = 100;

    const reqs = rateLimit.get(userKey) || [];
    const validReqs = reqs.filter(time => now - time < window);
    if (validReqs.length >= limit) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    validReqs.push(now);
    rateLimit.set(userKey, validReqs);

    // Get or create chat session
    let session = await ChatSession.findOne({ userId });
    if (!session) {
      session = new ChatSession({
        userId,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }]
      });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Add user message to session
    session.messages.push({
      role: 'user',
      content: message
    });
    await session.save();

    // Prepare history for Gemini (system + recent 20 msgs)
    const history = session.messages.slice(-20).map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    // If no API key, fallback
    if (!GEMINI_API_KEY) {
      const fallbackResponse = getFallbackResponse(message);
      
      session.messages.push({
        role: 'model',
        content: fallbackResponse
      });
      session.updatedAt = new Date();
      await session.save();
      
      return res.json({ response: fallbackResponse });
    }

    // Call Gemini API (reuse)
    const response = await callGeminiAPI(message, history);
    
    // Add AI response to session
    session.messages.push({
      role: 'model',
      content: response
    });
    session.updatedAt = new Date();
    await session.save();
    
    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to get response from AI' });
  }
});

// Call Gemini API
async function callGeminiAPI(message, history) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  const requestBody = {
    contents: history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      topP: 0.95,
      topK: 32
    }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('Gemini API error:', errorData);
    throw new Error('Gemini API request failed');
  }

  const data = await response.json();
  
  if (data.candidates && data.candidates[0] && data.candidates[0].content) {
    return data.candidates[0].content.parts[0].text;
  }
  
  return 'I apologize, but I could not generate a response. Please try again.';
}

// Fallback responses when no API key is available
function getFallbackResponse(query) {
  const lowerQuery = query.toLowerCase();
  
  // Product-related queries
  if (lowerQuery.includes('product') || lowerQuery.includes('inventory')) {
    return "I can help you manage products! You can add new products, update quantities, track stock levels, and organize items by categories. Navigate to the Products page to get started.";
  }
  
  // Billing/Invoice queries
  if (lowerQuery.includes('bill') || lowerQuery.includes('invoice') || lowerQuery.includes('payment')) {
    return "For billing and invoices, you can access the Billing section to create new invoices, view payment history, and manage transactions. The system tracks all your billing activities.";
  }
  
  // Employee queries
  if (lowerQuery.includes('employee') || lowerQuery.includes('staff')) {
    return "Employee management allows you to add team members, assign roles, and manage their permissions. Contact your administrator for access to employee management features.";
  }
  
  // Refund queries
  if (lowerQuery.includes('refund') || lowerQuery.includes('return')) {
    return "To request a refund, go to the Refund Requests section. You can submit return requests and track their status. Our team will review your request promptly.";
  }
  
  // Report/Analytics queries
  if (lowerQuery.includes('report') || lowerQuery.includes('analytics') || lowerQuery.includes('statistic')) {
    return "Reports and analytics provide insights into your business performance. You can view sales reports, inventory status, and other key metrics in the Reports section.";
  }
  
  // How to use / Help
  if (lowerQuery.includes('how') || lowerQuery.includes('help') || lowerQuery.includes('guide')) {
    return "This inventory management system helps you track products, manage employees, handle billing, and view reports. Use the sidebar to navigate between different sections. Need help with a specific feature?";
  }
  
  // Login/Access issues
  if (lowerQuery.includes('login') || lowerQuery.includes('password') || lowerQuery.includes('access')) {
    return "For login issues, please contact your administrator. They can help reset your password or manage your account access permissions.";
  }
  
  // Subscription/Billing plans
  if (lowerQuery.includes('subscription') || lowerQuery.includes('plan') || lowerQuery.includes('upgrade')) {
    return "You can manage your subscription plan in the Billing section. Contact your administrator to upgrade or modify your plan.";
  }
  
  // Greeting
  if (lowerQuery.includes('hello') || lowerQuery.includes('hi') || lowerQuery.includes('hey')) {
    return "Hello! How can I assist you today? I can help with products, billing, employees, reports, and more.";
  }
  
  // Thank you
  if (lowerQuery.includes('thank') || lowerQuery.includes('thanks')) {
    return "You're welcome! If you have any more questions, feel free to ask. I'm here to help!";
  }
  
  // Default response
  return "Thank you for your question! I'm here to help with this inventory management system. I can assist with products, billing, employees, reports, refunds, and general usage. What would you like to know more about?";
}

// Clear conversation history for a user
router.post('/clear', protect, async (req, res) => {
  const userId = req.user.id;
  await ChatSession.deleteOne({ userId });
  rateLimit.delete(`chat:${userId}`);
  res.json({ success: true });
});

module.exports = router;
