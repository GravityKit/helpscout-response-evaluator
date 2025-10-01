# Help Scout Response Evaluator

A Help Scout dynamic app widget that evaluates support team responses using AI and provides feedback based on your support tone guidelines.

## Features

- **Automatic Response Analysis** - Evaluates the latest team response in Help Scout tickets
- **Smart Product Detection** - Automatically detects Shopify vs WordPress context from ticket tags
- **Detailed Scoring** - Rates responses on tone, clarity, English quality, problem resolution, and structure
- **Actionable Feedback** - Provides specific suggestions for improvement
- **Support Guidelines Integration** - Checks compliance with your specific support tone requirements

## Quick Start

1. **Deploy to Fly.io** (see setup instructions below)
2. **Set up Help Scout integration** 
3. **Add as sidebar widget in Help Scout**

## Setup Instructions

See the detailed setup guide for step-by-step instructions on:
- Creating GitHub repository
- Setting up Fly.io deployment
- Configuring Help Scout API access
- Adding the widget to Help Scout

## API Endpoints

- `POST /` - Help Scout webhook endpoint (receives ticket events)
- `GET /health` - Health check endpoint (returns service status)
- `GET /report` - Redirects to Google Sheets report

## Security Features

- **Rate Limiting** - 100 requests per 15 minutes per IP
- **Input Validation** - Joi schema validation for all webhook payloads
- **Request Timeouts** - 30s default, 60s for OpenAI API calls
- **CORS Protection** - Restricted to Help Scout domains only
- **Signature Validation** - HMAC-SHA1 verification for webhook authenticity
- **Payload Size Limits** - 1MB maximum request size
- **Error Sanitization** - Prevents information disclosure

## Environment Variables

**Required:**
- `OPENAI_API_KEY` - Your OpenAI API key
- `OPENAI_MODEL` - OpenAI model to use (e.g., "gpt-4")
- `HELPSCOUT_APP_ID` - Help Scout application ID
- `HELPSCOUT_APP_SECRET` - Help Scout application secret
- `HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY` - Help Scout webhook signature key
- `GOOGLE_CLIENT_EMAIL` - Google service account email
- `GOOGLE_PRIVATE_KEY` - Google service account private key
- `GOOGLE_SHEET_ID` - ID of Google Sheet for storing evaluations

**Optional:**
- `PORT` - Server port (default: 8080, set automatically by Fly.io)
- `NODE_ENV` - Environment (development/production)
- `LOG_LEVEL` - Winston log level (error/warn/info/debug, default: info)
- `DISABLE_SIGNATURE_VALIDATION` - Set to 'true' for local testing (not for production)

## Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Add your API keys to .env
# Start development server
npm run dev
```

Server runs on `http://localhost:8080`

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```