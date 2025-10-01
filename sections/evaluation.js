const fs = require('fs');
const path = require('path');
const axios = require('axios');
const he = require('he'); // HTML entity decoder
const { evaluationResponseFormat } = require('../schemas/evaluation');

/**
 * Evaluation Section - OpenAI-powered response evaluation
 *
 * This section evaluates Help Scout support responses using OpenAI API
 */

class EvaluationSection {
  constructor() {
    this.name = 'evaluation';
    this.title = 'Response Evaluation';
    this.icon = '📊';

    // Load prompt template
    const promptPath = path.join(__dirname, '../prompts/evaluation.md');
    this.promptTemplate = fs.readFileSync(promptPath, 'utf8');

    // Load styles configuration
    const stylesPath = path.join(__dirname, '../config/styles.json');
    this.styles = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));

    // Load ticket classification config
    const classificationPath = path.join(__dirname, '../config/ticket-classification.json');
    this.ticketClassification = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));

    // Load OpenAI configuration
    const openaiConfigPath = path.join(__dirname, '../config/openai.json');
    this.openaiConfig = JSON.parse(fs.readFileSync(openaiConfigPath, 'utf8'));

    // Load HTML templates and apply styles
    const templatesDir = path.join(__dirname, '../templates');
    this.templates = {
      evaluation: this.applyStylesToTemplate(fs.readFileSync(path.join(templatesDir, 'evaluation.html'), 'utf8')),
      processing: this.applyStylesToTemplate(fs.readFileSync(path.join(templatesDir, 'processing.html'), 'utf8')),
      error: this.applyStylesToTemplate(fs.readFileSync(path.join(templatesDir, 'error.html'), 'utf8'))
    };
  }

  /**
   * Apply styles from config to template string
   */
  applyStylesToTemplate(template) {
    const s = this.styles;
    
    // Create style variables
    const styleVars = {
      fontFamily: s.typography.fontFamily,
      fontSize: s.typography.fontSize.base,
      fontSizeSmall: s.typography.fontSize.small,
      fontSizeLarge: s.typography.fontSize.large,
      fontSizeHeading: s.typography.fontSize.heading,
      fontWeightNormal: s.typography.fontWeight.normal,
      fontWeightMedium: s.typography.fontWeight.medium,
      fontWeightBold: s.typography.fontWeight.bold,
      colorTextPrimary: s.colors.text.primary,
      colorTextMuted: s.colors.text.muted,
      colorTextBlue: s.colors.text.blue,
      colorTextGreen: s.colors.text.green,
      colorTextRed: s.colors.text.red,
      colorBgLight: s.colors.background.light,
      colorBgLightBlue: s.colors.background.lightBlue,
      colorBgLightYellow: s.colors.background.lightYellow,
      colorBorderLight: s.colors.border.light,
      colorBorderBlue: s.colors.border.blue,
      colorBorderRed: s.colors.border.red,
      spacing4: s.spacing['4'],
      spacing8: s.spacing['8'],
      spacing12: s.spacing['12'],
      spacing16: s.spacing['16'],
      borderRadius: s.borderRadius.default
    };
    
    // Replace all style placeholders
    let result = template;
    Object.keys(styleVars).forEach(key => {
      const placeholder = `{{${key}}}`;
      result = result.split(placeholder).join(styleVars[key]);
    });
    
    return result;
  }

  /**
   * Check if this section should be displayed for the given ticket
   */
  async shouldDisplay(ticket, conversation) {
    // Don't show for live chats
    const isChatConversation =
      ticket.type === 'chat' ||
      ticket.source?.type === 'chat' ||
      ticket.source?.type === 'beacon' ||
      (typeof ticket.type === 'string' && ticket.type.toLowerCase() === 'chat') ||
      (typeof ticket.source?.type === 'string' && ['chat', 'beacon'].includes(ticket.source.type.toLowerCase())) ||
      (ticket.subject && ticket.subject.startsWith('Live chat on '));

    return !isChatConversation;
  }

  /**
   * Process the evaluation and return HTML
   */
  async process(data) {
    const { ticket, conversation, response, cacheKey, cache, runningEvaluations } = data;

    // Check memory cache
    if (cache.has(cacheKey)) {
      console.log('FOUND IN MEMORY CACHE - using cached evaluation');
      const cachedEvaluation = cache.get(cacheKey);
      return this.renderEvaluation(cachedEvaluation);
    }

    // Check if already processing
    if (runningEvaluations.has(cacheKey)) {
      console.log('Already evaluating in background, returning processing message');
      return this.templates.processing;
    }

    // Check Google Sheets for cached result
    const sheetsEvaluation = await this.checkGoogleSheets(ticket.id, data.googleSheets);
    if (sheetsEvaluation) {
      console.log('FOUND EXISTING EVALUATION in Google Sheets - no OpenAI call needed!');
      cache.set(cacheKey, sheetsEvaluation);
      return this.renderEvaluation(sheetsEvaluation);
    }

    // Start background evaluation
    runningEvaluations.add(cacheKey);
    this.evaluateInBackground(data).finally(() => {
      runningEvaluations.delete(cacheKey);
    });

    return this.templates.processing;
  }

  /**
   * Check Google Sheets for existing evaluation
   */
  async checkGoogleSheets(ticketId, googleSheets) {
    if (!googleSheets) return null;

    try {
      console.log('Fetching existing data from Google Sheets...');
      const response = await googleSheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:P'
      });

      const rows = response.data.values || [];
      console.log(`Found ${rows.length} rows in Google Sheets`);

      if (rows.length > 0) {
        console.log('First few rows:', rows.slice(0, 3));
      }

      const today = new Date().toISOString().split('T')[0];
      console.log('Looking for ticket ID:', ticketId);
      console.log('Today date:', today);

      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        const rowTicketId = row[1];
        const rowDate = row[0] ? row[0].split('T')[0] : null;

        if (String(rowTicketId) === String(ticketId) && rowDate === today) {
          console.log('Existing row data:', row);
          return {
            overall_score: parseFloat(row[4]) || 0,
            categories: {
              tone_empathy: {
                score: parseFloat(row[5]) || 0,
                feedback: row[12] || ''
              },
              clarity_completeness: {
                score: parseFloat(row[6]) || 0,
                feedback: row[13] || ''
              },
              standard_of_english: {
                score: parseFloat(row[7]) || 0,
                feedback: row[14] || ''
              },
              problem_resolution: {
                score: parseFloat(row[8]) || 0,
                feedback: row[15] || ''
              }
            },
            key_improvements: (row[9] || '').split('; ').filter(x => x)
          };
        }
      }
    } catch (error) {
      console.error('Error checking Google Sheets:', error.message);
    }

    return null;
  }

  /**
   * Evaluate response in background
   */
  async evaluateInBackground(data) {
    try {
      const { ticket, conversation, response, cacheKey, cache, googleSheets } = data;

      // Decode HTML entities before evaluation
      const cleanText = this.decodeHtml(response.text);

      const evaluation = await this.evaluateResponse(cleanText, conversation, ticket);

      cache.set(cacheKey, evaluation);
      console.log('Background evaluation completed:', evaluation.overall_score);
      console.log('CACHING BACKGROUND RESULT with key:', cacheKey);

      // Save to Google Sheets
      if (googleSheets && response.agent) {
        await this.saveToGoogleSheets(googleSheets, ticket, response, evaluation);
      }
    } catch (error) {
      console.error('Background evaluation error:', error.message);
    }
  }

  /**
   * Decode HTML entities and clean text
   */
  decodeHtml(text) {
    // First decode HTML entities like &nbsp;
    let decoded = he.decode(text);

    // Then remove HTML tags
    decoded = decoded.replace(/<[^>]*>/g, ' ');

    // Clean up whitespace
    decoded = decoded.replace(/\s+/g, ' ').trim();

    return decoded;
  }

  /**
   * Evaluate response using OpenAI (supports both GPT-5 and GPT-4)
   */
  async evaluateResponse(cleanText, conversation, ticketData) {
    // Get conversation context
    const conversationContext = this.getConversationContext(conversation);

    // Detect ticket type
    const contextNote = this.getContextNote(ticketData, cleanText);

    // Build prompt from template
    const prompt = this.promptTemplate
      .replace('{{CONTEXT_NOTE}}', contextNote)
      .replace('{{CONVERSATION_CONTEXT}}', conversationContext || 'No previous conversation context available')
      .replace('{{RESPONSE_TEXT}}', cleanText);

    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is missing');
      }

      // Get model (environment variable overrides config file)
      const model = process.env.OPENAI_MODEL || this.openaiConfig.model;
      const isGPT5 = model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');

      let requestBody;
      let logParams;

      if (isGPT5) {
        // GPT-5 with Chat Completions API uses reasoning_effort and verbosity (not nested objects)
        const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || this.openaiConfig.reasoning?.effort || 'low';
        const textVerbosity = process.env.OPENAI_TEXT_VERBOSITY || this.openaiConfig.text?.verbosity || 'medium';
        const maxOutputTokens = parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS) || this.openaiConfig.max_output_tokens || 1500;

        logParams = `model: ${model}, reasoning_effort: ${reasoningEffort}, verbosity: ${textVerbosity}, max_output_tokens: ${maxOutputTokens}`;

        requestBody = {
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at evaluating customer support responses.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          reasoning_effort: reasoningEffort,
          verbosity: textVerbosity,
          max_output_tokens: maxOutputTokens,
          response_format: evaluationResponseFormat
        };
      } else {
        // GPT-4 and earlier use traditional temperature and max_tokens
        const temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || this.openaiConfig.temperature || 0.1;
        const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || this.openaiConfig.max_tokens || 1500;

        logParams = `model: ${model}, temperature: ${temperature}, max_tokens: ${maxTokens}`;

        requestBody = {
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at evaluating customer support responses. Always respond with valid JSON only, no other text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature,
          max_tokens: maxTokens
        };
      }

      console.log('Making OpenAI API call...');
      console.log('Using', logParams);

      const apiResponse = await axios.post('https://api.openai.com/v1/chat/completions', requestBody, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout for OpenAI API (evaluations can take time)
      });

      console.log('OpenAI API call successful');

      let evaluation;
      if (isGPT5) {
        // GPT-5 with Structured Outputs - guaranteed schema adherence
        evaluation = apiResponse.data.choices[0].message.parsed;
        console.log('Using GPT-5 Structured Outputs - no validation needed');
      } else {
        // GPT-4 - parse JSON manually
        const content = apiResponse.data.choices[0].message.content;
        evaluation = JSON.parse(content);
        console.log('Using GPT-4 - validating response');

        // Validate and fix common issues (only for GPT-4)
        evaluation = this.validateEvaluation(evaluation, cleanText, ticketData);
      }

      return evaluation;

    } catch (error) {
      console.error('OpenAI API error:', error.response?.data || error.message);
      return {
        overall_score: 0,
        categories: {
          tone_empathy: { score: 0, feedback: "Unable to evaluate - API error" },
          clarity_completeness: { score: 0, feedback: "Unable to evaluate - API error" },
          standard_of_english: { score: 0, feedback: "Unable to evaluate - API error" },
          problem_resolution: { score: 0, feedback: "Unable to evaluate - API error" }
        },
        key_improvements: ["OpenAI API error occurred - check logs for details"],
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Get conversation context for prompt
   */
  getConversationContext(conversation) {
    if (!conversation._embedded?.threads) return '';

    return [...conversation._embedded.threads]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-5)
      .map(thread => {
        const isCustomer = thread.createdBy === 'customer' || thread.createdBy?.type === 'customer';
        const isTeam = thread.createdBy === 'user' || thread.createdBy?.type === 'user';
        const sender = isCustomer ? 'CUSTOMER' : isTeam ? 'TEAM' : 'SYSTEM';
        const text = thread.body ? this.decodeHtml(thread.body) : '';
        return `${sender}: ${text}`;
      })
      .filter(msg => msg.length > 10)
      .join('\n\n');
  }

  /**
   * Get context note based on ticket type
   */
  getContextNote(ticketData, cleanText) {
    const tags = ticketData?.tags || [];
    const config = this.ticketClassification;

    // Check for services ticket
    const isServicesTicket = tags.some(tag =>
      config.services.keywords.some(keyword =>
        tag.toLowerCase().includes(keyword)
      )
    );

    // Check for presales ticket
    const isPresalesTicket = tags.some(tag =>
      config.presales.keywords.some(keyword =>
        tag.toLowerCase().includes(keyword)
      )
    ) || (ticketData?.subject && config.presales.subject_keywords.some(keyword =>
      ticketData.subject.toLowerCase().includes(keyword)
    ));

    // Check for investigating phase
    const isInvestigating = config.investigating.phrases.some(phrase =>
      cleanText.toLowerCase().includes(phrase.toLowerCase())
    );

    console.log('Ticket context detection:', {
      isServicesTicket,
      isPresalesTicket,
      isInvestigating,
      tags: tags.join(', ') || 'none'
    });

    if (isServicesTicket) {
      return config.services.context_note;
    } else if (isPresalesTicket) {
      return config.presales.context_note;
    } else if (isInvestigating) {
      return config.investigating.context_note;
    }

    return '';
  }

  /**
   * Validate evaluation to prevent contradictory feedback
   */
  validateEvaluation(evaluation, responseText, ticketData) {
    // Check for contradictory feedback
    const clarityFeedback = evaluation.categories?.clarity_completeness?.feedback || '';
    const resolutionFeedback = evaluation.categories?.problem_resolution?.feedback || '';

    // Fix contradiction: "be more concise" vs "provide more detail"
    if (clarityFeedback.toLowerCase().includes('concise') &&
        resolutionFeedback.toLowerCase().includes('more detail')) {
      // Remove the "more detail" feedback
      evaluation.categories.problem_resolution.feedback = resolutionFeedback.replace(/provide more detail/gi, '').trim();
    }

    // Adjust scores for services tickets
    const tags = ticketData?.tags || [];
    const isServicesTicket = tags.some(tag =>
      this.ticketClassification.services.keywords.some(keyword =>
        tag.toLowerCase().includes(keyword)
      )
    );

    if (isServicesTicket && evaluation.categories?.tone_empathy) {
      // Boost tone scores for services tickets (different communication standards)
      evaluation.categories.tone_empathy.score = Math.max(
        evaluation.categories.tone_empathy.score, 7
      );
      evaluation.categories.tone_empathy.feedback = 'Services team communication - standard tone requirements adjusted';
    }

    // Clean up improvements list
    if (evaluation.key_improvements && Array.isArray(evaluation.key_improvements)) {
      evaluation.key_improvements = evaluation.key_improvements.filter(imp => {
        if (!imp || imp.length < 5) return false;
        if (imp.toLowerCase().includes('continue') && imp.toLowerCase().includes('good')) return false;
        if (imp.toLowerCase() === 'no recommendations') return false;
        return true;
      });

      if (evaluation.key_improvements.length === 0) {
        evaluation.key_improvements = ['No recommendations'];
      }
    }

    return evaluation;
  }

  /**
   * Save evaluation to Google Sheets
   */
  async saveToGoogleSheets(googleSheets, ticket, response, evaluation) {
    try {
      console.log('About to append to Google Sheets...');
      console.log('Spreadsheet ID:', process.env.GOOGLE_SHEET_ID);

      const timestamp = new Date().toISOString();
      const rowData = [
        timestamp,
        ticket.id,
        response.agent.id,
        response.agent.name,
        evaluation.overall_score,
        evaluation.categories.tone_empathy.score,
        evaluation.categories.clarity_completeness.score,
        evaluation.categories.standard_of_english.score,
        evaluation.categories.problem_resolution.score,
        evaluation.key_improvements.join('; '),
        response.text,
        ticket.number,
        evaluation.categories.tone_empathy.feedback,
        evaluation.categories.clarity_completeness.feedback,
        evaluation.categories.standard_of_english.feedback,
        evaluation.categories.problem_resolution.feedback
      ];

      console.log('Row data length:', rowData.length);
      console.log('Row data:', rowData);

      const sheetsClient = googleSheets.spreadsheets;
      console.log('Sheets client available:', !!sheetsClient);

      const result = await sheetsClient.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:P',
        valueInputOption: 'RAW',
        resource: {
          values: [rowData]
        }
      });

      console.log('Google Sheets append SUCCESS!');
      console.log('Result data:', result.data);
      console.log('Updated range:', result.data.updates.updatedRange);
      console.log('Updated rows:', result.data.updates.updatedRows);
      console.log('Evaluation saved to Google Sheets for agent:', response.agent.name);

    } catch (error) {
      console.error('Failed to save to Google Sheets:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
    }
  }

  /**
   * Render evaluation HTML
   */
  renderEvaluation(evaluation) {
    try {
      if (evaluation.error) {
        return this.templates.error.replace('{{error_message}}', this.escapeHtml(evaluation.error));
      }

      // Get style values
      const s = this.styles;
      
      // Build categories HTML
      let categoriesHTML = '';
      const cats = evaluation.categories;
      if (cats.tone_empathy) categoriesHTML += `<p style="font-size: ${s.typography.fontSize.small}; margin: ${s.spacing['4']} 0;"><strong>Tone & Empathy:</strong> ${cats.tone_empathy.score}/10 - ${cats.tone_empathy.feedback}</p>`;
      if (cats.clarity_completeness) categoriesHTML += `<p style="font-size: ${s.typography.fontSize.small}; margin: ${s.spacing['4']} 0;"><strong>Clarity:</strong> ${cats.clarity_completeness.score}/10 - ${cats.clarity_completeness.feedback}</p>`;
      if (cats.standard_of_english) categoriesHTML += `<p style="font-size: ${s.typography.fontSize.small}; margin: ${s.spacing['4']} 0;"><strong>English:</strong> ${cats.standard_of_english.score}/10 - ${cats.standard_of_english.feedback}</p>`;
      if (cats.problem_resolution) categoriesHTML += `<p style="font-size: ${s.typography.fontSize.small}; margin: ${s.spacing['4']} 0;"><strong>Problem Resolution:</strong> ${cats.problem_resolution.score}/10 - ${cats.problem_resolution.feedback}</p>`;

      // Build improvements HTML
      let improvementsHTML = '';
      if (evaluation.key_improvements && evaluation.key_improvements.length > 0) {
        improvementsHTML = `<div style="margin-top: ${s.spacing['12']}; padding: ${s.spacing['8']}; background: ${s.colors.background.lightYellow}; border-radius: ${s.borderRadius.default};"><strong style="font-size: ${s.typography.fontSize.small};">Key Improvements: </strong><ul style="margin: ${s.spacing['4']} 0; padding-left: ${s.spacing['16']};">`;
        evaluation.key_improvements.forEach(improvement => {
          improvementsHTML += `<li style="font-size: 10px; margin: 2px 0;">${improvement}</li>`;
        });
        improvementsHTML += '</ul></div>';
      } else {
        improvementsHTML = `<div style="margin-top: ${s.spacing['12']}; padding: ${s.spacing['8']}; background: ${s.colors.background.lightGreen}; border-radius: ${s.borderRadius.default};"><strong style="font-size: ${s.typography.fontSize.small};">Key Improvements: </strong><span style="font-size: 10px;">No recommendations - excellent response!</span></div>`;
      }

      // Render template
      return this.templates.evaluation
        .replace('{{overall_score}}', evaluation.overall_score)
        .replace('{{categories_html}}', categoriesHTML)
        .replace('{{improvements_html}}', improvementsHTML);

    } catch (error) {
      console.error('Error rendering evaluation:', {
        error: error.message,
        stack: error.stack
      });
      return this.templates.error.replace('{{error_message}}', this.escapeHtml('Unable to display evaluation results. Please refresh the page.'));
    }
  }

  /**
   * Escape HTML for safe output
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

module.exports = EvaluationSection;
