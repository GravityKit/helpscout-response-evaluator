const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { LRUCache } = require('lru-cache');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
require('dotenv').config();

// Load logger
const logger = require('./config/logger');

// Load modular sections
const EvaluationSection = require('./sections/evaluation');

// Google Sheets integration
const { google } = require('googleapis');
let sheetsClient = null;

// Initialize Google Sheets client
try {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID) {
    const credentials = {
      type: 'service_account',
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    sheetsClient = google.sheets({ version: 'v4', auth });
    logger.info('Google Sheets integration available');
  } else {
    logger.warn('Google Sheets credentials not found - using mock data');
  }
} catch (error) {
  logger.error('Google Sheets setup error', { error: error.message });
}

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize modular sections
const evaluationSection = new EvaluationSection();

// LRU cache for evaluations (max 500 items, 24 hour TTL)
const evaluationCache = new LRUCache({
  max: 500, // Maximum 500 cached evaluations
  ttl: 1000 * 60 * 60 * 24, // 24 hour TTL
  updateAgeOnGet: true, // Refresh TTL on access
  updateAgeOnHas: false
});

// Track running OpenAI requests to prevent duplicates
const runningEvaluations = new Set();

// Middleware - Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

app.use(limiter);

// Validation schema for Help Scout Dynamic Content API
// Keep validation minimal - only require what's truly necessary
const webhookSchema = Joi.object({
  ticket: Joi.object({
    id: Joi.number().required()
  }).unknown(true).required(), // ticket.id is the only required field
  customer: Joi.object().unknown(true).optional(),
  user: Joi.object().unknown(true).optional(),
  mailbox: Joi.object().unknown(true).optional()
}).unknown(true); // Allow all additional fields from Help Scout

// Input validation middleware
function validateWebhookPayload(req, res, next) {
  const { error, value } = webhookSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    logger.warn('Webhook payload validation failed', {
      errors: error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      })),
      ip: req.ip,
      path: req.path
    });
    
    return res.status(400).json({
      html: `
        <div style="font-family: Arial, sans-serif; padding: 16px; color: #c30; border: 2px solid #c30; border-radius: 4px;">
          <h3 style="margin: 0 0 8px 0;">⚠️ Invalid Request</h3>
          <p style="margin: 0; font-size: 12px;">The request payload is invalid. Please contact support if this issue persists.</p>
        </div>
      `
    });
  }

  req.body = value; // Use validated data
  next();
}

// Middleware - Restrict CORS to Help Scout domains only
app.use(cors({
  origin: [
    'https://secure.helpscout.net',
    /^https:\/\/.*\.helpscout\.net$/
  ],
  credentials: true,
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-HelpScout-Signature']
}));
// Capture raw body for signature validation before JSON parsing
app.use(express.json({
  limit: '1mb', // Limit payload size to 1MB
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request timeout middleware (30 seconds for Help Scout webhooks)
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    logger.error('Request timeout', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(408).json({
      html: `
        <div style="font-family: Arial, sans-serif; padding: 16px; color: #c30; border: 2px solid #c30; border-radius: 4px;">
          <h3 style="margin: 0 0 8px 0;">⏱️ Request Timeout</h3>
          <p style="margin: 0; font-size: 12px;">The request took too long to process. Please try again.</p>
        </div>
      `
    });
  });
  next();
});

// Helper function to escape HTML content safely
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Validate Help Scout webhook signature
function validateHelpScoutSignature(req) {
  // Allow disabling validation for local development
  if (process.env.DISABLE_SIGNATURE_VALIDATION === 'true') {
    logger.warn('Signature validation is DISABLED - not for production use');
    return true;
  }

  const signature = req.headers['x-helpscout-signature'];
  // Use new variable name with backward compatibility
  const secret = process.env.HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY || process.env.HELPSCOUT_APP_SECRET;

  // Fail-secure: reject if secret not configured
  if (!secret) {
    logger.error('HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY not configured - rejecting request', {
      ip: req.ip,
      path: req.path
    });
    return false;
  }

  // Reject if signature header missing
  if (!signature) {
    logger.error('X-HelpScout-Signature header missing', {
      ip: req.ip,
      path: req.path
    });
    return false;
  }

  try {
    const crypto = require('crypto');
    const rawBody = req.rawBody || '';

    // Compute HMAC-SHA1 signature (as per Help Scout documentation)
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(rawBody);
    const computedSignature = hmac.digest('base64');

    // Timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const computedBuffer = Buffer.from(computedSignature);

    // Buffers must be same length for timingSafeEqual
    if (signatureBuffer.length !== computedBuffer.length) {
      logger.error('Signature validation failed: length mismatch', {
        receivedLength: signatureBuffer.length,
        computedLength: computedBuffer.length,
        ip: req.ip
      });
      return false;
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, computedBuffer);

    if (!isValid) {
      logger.error('Signature validation failed: signature mismatch', {
        ip: req.ip,
        path: req.path,
        receivedSignature: signature.substring(0, 10) + '...',
        computedSignature: computedSignature.substring(0, 10) + '...'
      });
    } else {
      logger.info('Signature validation passed', { ip: req.ip });
    }

    return isValid;

  } catch (error) {
    logger.error('Signature validation error', {
      error: error.message,
      ip: req.ip,
      stack: error.stack
    });
    return false;
  }
}

// Help Scout dynamic app endpoint
app.post('/', validateWebhookPayload, async (req, res) => {
  try {
    logger.info('Help Scout request received', {
      ticketId: req.body?.ticket?.id,
      ip: req.ip
    });

    // Validate Help Scout signature
    if (!validateHelpScoutSignature(req)) {
      logger.error('Unauthorized request - signature validation failed', {
        ip: req.ip,
        ticketId: req.body?.ticket?.id
      });
      return res.status(401).json({
        html: `
          <div style="font-family: Arial, sans-serif; padding: 16px; color: #c30; border: 2px solid #c30; border-radius: 4px;">
            <h3 style="margin: 0 0 8px 0;">🚨 Unauthorized Request</h3>
            <p style="margin: 0; font-size: 12px;">Signature validation failed. Please check your Help Scout app configuration.</p>
          </div>
        `
      });
    }

    const { ticket, customer, user, mailbox } = req.body;
    
    if (!ticket || !ticket.id) {
      return res.json({
        html: '<div style="padding: 20px;">No ticket data received.</div>'
      });
    }
    
    // Log ticket tags for debugging
    if (ticket.tags && ticket.tags.length > 0) {
      logger.debug('Ticket tags', { 
        ticketId: ticket.id,
        tags: ticket.tags 
      });
    }

    // Check if evaluation section should be displayed
    const shouldDisplay = await evaluationSection.shouldDisplay(ticket, null);
    
    if (!shouldDisplay) {
      logger.info('Skipping evaluation for this ticket type', {
        ticketId: ticket.id,
        ticketType: ticket.type
      });
      return res.json({
        html: `
          <div style="font-family: Arial, sans-serif; padding: 16px; text-align: center; color: #666;">
            <h3 style="margin: 0 0 8px 0; font-size: 14px;">📊 Response Evaluator</h3>
            <p style="margin: 0; font-size: 12px;">Not available for chats</p>
          </div>
        `
      });
    }

    // Get conversation threads from Help Scout API
    const conversation = await getHelpScoutConversation(ticket.id);
    
    if (!conversation) {
      return res.json({
        html: `
          <div style="padding: 20px; font-family: Arial, sans-serif;">
            <h3>📊 Response Evaluator</h3>
            <p>Could not fetch conversation data.</p>
            <p>Ticket: #${ticket.number}</p>
          </div>
        `
      });
    }

    // Find the latest team response
    logger.debug('Looking for latest team response', { ticketId: ticket.id });
    const latestResponse = findLatestTeamResponse(conversation);
    
    if (!latestResponse) {
      logger.info('No team response found', { ticketId: ticket.id });
      return res.json({
        html: `
          <div style="padding: 20px; font-family: Arial, sans-serif;">
            <h3>📊 Response Evaluator</h3>
            <p>No team response found to evaluate.</p>
            <p>Ticket: #${ticket.number}</p>
          </div>
        `
      });
    }

    logger.debug('Found team response', { 
      ticketId: ticket.id,
      responseLength: latestResponse.text?.length || 0,
      agentName: latestResponse.createdBy?.first
    });

    // Create cache key from response content hash (persistent across restarts)
    const crypto = require('crypto');
    const responseHash = crypto.createHash('md5').update(latestResponse.text).digest('hex').substring(0, 8);
    const cacheKey = `${ticket.id}_${responseHash}`;
    
    // Use modular section to process evaluation
    const html = await evaluationSection.process({
      ticket,
      conversation,
      response: {
        text: latestResponse.text,
        agent: {
          id: latestResponse.createdBy?.id || 'unknown',
          name: latestResponse.createdBy?.first || 'Unknown'
        }
      },
      cacheKey,
      cache: evaluationCache,
      runningEvaluations,
      googleSheets: sheetsClient
    });
    
    return res.json({ html });

  } catch (error) {
    logger.error('Error processing evaluation', {
      ticketId: req.body?.ticket?.id,
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    res.json({
      html: `
        <div style="padding: 20px; font-family: Arial, sans-serif;">
          <h3>📊 Response Evaluator</h3>
          <p style="color: red;">Error: ${escapeHtml('An error occurred while processing your request. Please try again.')}</p>
        </div>
      `
    });
  }
});

// Get conversation from Help Scout API
async function getHelpScoutConversation(conversationId) {
  try {
    let accessToken = process.env.HELPSCOUT_ACCESS_TOKEN;
    
    if (!accessToken) {
      logger.debug('Attempting to get OAuth token', { conversationId });
      const authResponse = await axios.post('https://api.helpscout.net/v2/oauth2/token', {
        grant_type: 'client_credentials',
        client_id: process.env.HELPSCOUT_APP_ID,
        client_secret: process.env.HELPSCOUT_APP_SECRET
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout for auth
      });
      
      accessToken = authResponse.data.access_token;
    }

    logger.debug('Fetching conversation threads', { conversationId });
    const threadsResponse = await axios.get(`https://api.helpscout.net/v2/conversations/${conversationId}/threads`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000 // 15 second timeout for API calls
    });
    
    logger.debug('Conversation threads retrieved', { 
      conversationId,
      threadCount: threadsResponse.data._embedded?.threads?.length || 0
    });
    
    return {
      _embedded: { threads: threadsResponse.data._embedded?.threads || [] }
    };
    
  } catch (error) {
    logger.error('Help Scout API error', {
      conversationId,
      error: error.message,
      responseData: error.response?.data,
      stack: error.stack
    });
    return null;
  }
}

// Find the most recent response from a team member
function findLatestTeamResponse(conversation) {
  if (!conversation._embedded?.threads) {
    return null;
  }

  const threads = [...conversation._embedded.threads].sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );

  for (const thread of threads) {
    const isUser = thread.createdBy === 'user' || thread.createdBy?.type === 'user';
    
    if (thread.type === 'message' && isUser && thread.body) {
      logger.debug('Found team response', {
        agentName: thread.createdBy?.first || 'Unknown',
        createdAt: thread.createdAt
      });
      return {
        text: thread.body,
        createdAt: thread.createdAt,
        createdBy: thread.createdBy
      };
    }
  }

  return null;
}


// Health check endpoint
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      googleSheets: !!sheetsClient,
      openai: !!process.env.OPENAI_API_KEY,
      helpScout: !!(process.env.HELPSCOUT_APP_ID && process.env.HELPSCOUT_APP_SECRET)
    },
    cache: {
      size: evaluationCache.size,
      maxSize: evaluationCache.max
    }
  };
  
  res.status(200).json(healthCheck);
});

// Report endpoint - redirect to Google Sheet
app.get('/report', (req, res) => {
  if (!process.env.GOOGLE_SHEET_ID) {
    return res.json({ 
      error: 'Google Sheets not configured', 
      message: 'All evaluations are being saved to Google Sheets. Please configure GOOGLE_SHEET_ID to access reports.',
      sheet_url: 'https://docs.google.com/spreadsheets/d/1UCy71O0ctbEKoYCyx9wFiKyEfs0zT3jcINVebaALfo8/edit#gid=0'
    });
  }
  
  // Redirect to the Google Sheet
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit#gid=0`;
  res.redirect(sheetUrl);
});

// Generate AI pattern analysis for an agent
async function generatePatternAnalysis(agentName, allImprovements) {
  if (!allImprovements || !process.env.OPENAI_API_KEY) {
    return 'No pattern analysis available';
  }

  try {
    const prompt = `Analyze the following improvement suggestions for support agent "${agentName}" and identify recurring patterns or themes. Be concise (under 100 words):

Improvement suggestions: ${allImprovements}

Focus on:
1. Most common issues
2. Specific areas for improvement
3. Any positive patterns
4. Training recommendations

Provide a brief summary of patterns found.`;

    const apiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing customer support feedback to identify training opportunities. Be concise and actionable.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,  // Lower temperature for consistent pattern analysis
      max_tokens: 200
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return apiResponse.data.choices[0].message.content.replace(/"/g, '""'); // Escape quotes for CSV
  } catch (error) {
    logger.error('Pattern analysis error', {
      agentName,
      error: error.message,
      stack: error.stack
    });
    return 'Pattern analysis failed';
  }
}

app.listen(PORT, '0.0.0.0', () => {
  logger.info('Help Scout Response Evaluator started', {
    port: PORT,
    host: '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    googleSheetsEnabled: !!sheetsClient
  });
});
