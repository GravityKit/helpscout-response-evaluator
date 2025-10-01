# Complete Setup Guide for Help Scout Response Evaluator

This guide will walk you through setting up your Help Scout response evaluation widget from start to finish.

## 🔐 FIRST: Secure Your OpenAI API Key

**IMPORTANT**: The API key you shared is now exposed publicly. You must:

1. Go to https://platform.openai.com/api-keys
2. Click on the key that starts with "sk-proj-nzX..."
3. Click "Delete" to revoke it
4. Click "Create new secret key"
5. Copy the new key and keep it safe (you'll need it later)

## 📋 What You'll Need for Help Scout API

To access Help Scout's API, you need to create an OAuth2 application:

1. **Go to Help Scout Developer Settings**:
   - Log into Help Scout
   - Go to Profile → Developer → My Apps
   - Click "Create App"

2. **App Settings**:
   - **App Name**: "Response Evaluator"
   - **Redirection URL**: `https://your-app-name.fly.dev/auth/callback` (you'll update this later)
   - **App Type**: Choose "Dynamic App"

3. **Copy These Values** (you'll need them):
   - App ID
   - App Secret

## 🚀 Step 1: Set Up GitHub Repository

1. **Create New Repository**:
   - Go to https://github.com
   - Click "New repository"
   - Repository name: `helpscout-response-evaluator`
   - Make it **Private**
   - Don't initialize with README (we have files ready)
   - Click "Create repository"

2. **Upload Your Files**:
   - Download all the files I created from `/Users/katiekeith/Documents/helpscout-response-evaluator/`
   - On your new GitHub repo page, click "uploading an existing file"
   - Drag and drop all files EXCEPT `.env.example` (don't upload the example file)
   - Commit message: "Initial commit - Help Scout response evaluator"
   - Click "Commit changes"

## 🛩️ Step 2: Set Up Fly.io

1. **Install Fly CLI** (if you don't have it):
   - Go to https://fly.io/docs/hands-on/install-flyctl/
   - Follow instructions for Mac
   - Run `flyctl auth login` in Terminal

2. **Deploy Your App**:
   ```bash
   # Navigate to your project folder
   cd /Users/katiekeith/Documents/helpscout-response-evaluator
   
   # Create Fly app (choose a unique name)
   flyctl apps create helpscout-response-evaluator-katie
   
   # Set your environment variables
   flyctl secrets set OPENAI_API_KEY="your-new-openai-key-here"
   flyctl secrets set HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY="your-secret-from-helpscout"
   flyctl secrets set HELPSCOUT_APP_ID="your-app-id-from-helpscout"
   flyctl secrets set HELPSCOUT_APP_SECRET="your-app-secret-from-helpscout"
   flyctl secrets set GOOGLE_SHEET_ID="your-google-sheet-id"
   flyctl secrets set GOOGLE_CLIENT_EMAIL="your-service-account-email"
   flyctl secrets set GOOGLE_PRIVATE_KEY="your-private-key"

   # Deploy the app
   flyctl deploy
   ```

3. **Share Your Google Sheet** (Required for caching):
   - Open your Google Cloud service account JSON file
   - Find the `"client_email"` field (e.g., `your-project@project-id.iam.gserviceaccount.com`)
   - Open your Google Sheet at `https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}`
   - Click "Share" button (top right)
   - Add the email from your JSON file's `client_email` field
   - Set permission: **Editor**
   - Click "Done"
   
   ⚠️ **Without this**: App still works but makes duplicate OpenAI API calls (increased costs)

**Where to Find These Values:**

- **OPENAI_API_KEY**: Create at https://platform.openai.com/api-keys
- **HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY**: Help Scout → Profile → Developer → My Apps → Your App → "Secret Key"
- **HELPSCOUT_APP_ID**: Help Scout → Profile → Developer → My Apps → Your App → "App ID"
- **HELPSCOUT_APP_SECRET**: Help Scout → Profile → Developer → My Apps → Your App → "App Secret"
- **GOOGLE_SHEET_ID**: From your Google Sheet URL: `https://docs.google.com/spreadsheets/d/{THIS_PART}`
- **GOOGLE_CLIENT_EMAIL**: From your service account JSON file → `"client_email"` field
- **GOOGLE_PRIVATE_KEY**: From your service account JSON file → `"private_key"` field (entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines)

4. **Get Your App URL**:
   - After deployment, Fly will show you a URL like: `https://helpscout-response-evaluator-katie.fly.dev`
   - Copy this URL - you'll need it for Help Scout

## 🎯 Step 3: Configure Help Scout Integration

1. **Update Your Help Scout App**:
   - Go back to Help Scout Developer settings
   - Edit your app
   - Update **Redirection URL** to: `https://your-app-name.fly.dev/auth/callback`

2. **Set Up Dynamic App**:
   - In your Help Scout app settings
   - Go to "Dynamic Content" tab
   - Add new dynamic content:
     - **Name**: "Response Evaluation"
     - **Placement**: "Sidebar"
     - **URL**: `https://your-app-name.fly.dev/widget`
     - **Height**: 400px

3. **Install App in Help Scout**:
   - Go to Help Scout → Apps
   - Find your "Response Evaluator" app
   - Click "Install"

## 🧪 Step 4: Test Your Widget

1. **Open a Help Scout Ticket**:
   - Find any ticket with team responses
   - Look for your "Response Evaluation" widget in the sidebar
   - It should automatically analyze the latest response

2. **Check for Shopify Detection**:
   - Test with a ticket tagged "Shopify" - should say "app"
   - Test with a WordPress ticket - should say "plugin"

## 🔒 Security: Signature Validation

The app validates all incoming Help Scout webhooks using HMAC-SHA1 signature verification to prevent unauthorized requests.

### How Signature Validation Works

Help Scout uses HMAC-SHA1 to sign webhook requests:

1. **Help Scout computes signature**: Creates HMAC-SHA1 hash of the raw request body using your secret key
2. **Sends X-HelpScout-Signature header**: 28-character base64-encoded signature (e.g., `E6Fa3PPJBwgrJhklyA3quasHiMY=`)
3. **App validates**: Recomputes signature and compares using timing-safe comparison
4. **Rejects unauthorized**: Returns 401 Unauthorized if signature is missing or invalid

**Important**: Help Scout uses **SHA1** (not SHA256) for Dynamic App webhooks:
- SHA1 signatures: 28 characters (e.g., `E6Fa3PPJBwgrJhklyA3quasHiMY=`)
- SHA256 signatures: 44 characters (used for OAuth, not webhooks)

### Example Signature Calculation

```javascript
const crypto = require('crypto');

const secret = 'your-secret-key';
const body = '{"ticket":{"id":"123456"}}';

const hmac = crypto.createHmac('sha1', secret);
hmac.update(body);
const signature = hmac.digest('base64');
// Result: 28-character base64 string
```

### Production Setup

**Required for Production:**
- Set `HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY` in Fly.io secrets (get this from Help Scout app settings)
- All requests without valid signatures are rejected with 401 Unauthorized
- Uses timing-safe comparison (`crypto.timingSafeEqual`) to prevent timing attacks

```bash
flyctl secrets set HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY="your-secret-here"
```

### Local Development

If you need to test locally without valid Help Scout signatures, you can temporarily disable validation:

```bash
# In your .env file (DO NOT use in production!)
DISABLE_SIGNATURE_VALIDATION=true
```

**Testing with Valid Signatures:**
Use the included test utility to generate valid signatures:

```bash
node test-signature.js
# Outputs example signatures for testing
```

⚠️ **WARNING**: Never deploy with signature validation disabled. This would allow anyone to make unauthorized requests to your app.

### Dynamic App Architecture

**Important**: Help Scout Dynamic Apps use **server-to-server POST requests**, not client-side widgets:
- All requests come to `POST /` endpoint with signature validation
- `widget.html` and `widget.js` files are NOT used by Dynamic Apps
- No public endpoints exist without validation

## 📊 Google Sheets Setup (Optional but Recommended)

The app caches evaluations in Google Sheets to avoid duplicate OpenAI API calls.

### Setting Up Your Google Sheet

**1. Create the spreadsheet** (if you haven't already) at https://sheets.google.com

**2. Add the following headers in Row 1:**

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Conversation ID | Agent ID | Agent Name | Overall Score | Tone Score | Clarity Score | Grammar Score | Problem Solving Score | Areas for Improvement | Response Text | Ticket Number | Tone Feedback | Clarity Feedback | Grammar Feedback | Problem Solving Feedback |

**Column Descriptions:**
- **Timestamp**: When the evaluation was performed (ISO 8601 format)
- **Conversation ID**: Help Scout conversation/ticket ID
- **Agent ID**: Help Scout agent user ID
- **Agent Name**: Agent's display name
- **Overall Score**: Average of all category scores (0-10)
- **Tone Score**: Friendliness and professionalism rating (0-10)
- **Clarity Score**: How clear and direct the response is (0-10)
- **Grammar Score**: Writing quality and correctness (0-10)
- **Problem Solving Score**: Effectiveness of the solution (0-10)
- **Areas for Improvement**: Specific feedback on what could be better
- **Response Text**: The actual agent response (HTML format)
- **Ticket Number**: Help Scout ticket number
- **Tone Feedback**: Detailed explanation of tone score
- **Clarity Feedback**: Detailed explanation of clarity score
- **Grammar Feedback**: Detailed explanation of grammar score
- **Problem Solving Feedback**: Detailed explanation of problem solving score

**3. Format the sheet** (optional but recommended):
- Freeze Row 1 (View → Freeze → 1 row)
- Bold the header row
- Enable text wrapping for feedback columns
- Set column widths: ID columns (100px), Score columns (80px), Feedback columns (300px)

### Service Account Permissions

**Required**: Share your Google Sheet with your service account email (from your Google Cloud JSON file):

1. **Find your service account email**: 
   - Open your Google Cloud service account JSON file
   - Look for the `"client_email"` field
   - Example: `"your-project@your-project-id.iam.gserviceaccount.com"`
   
2. **Share the Google Sheet**:
   - Open your Google Sheet: `https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}`
   - Click "Share" button (top right)
   - Add the email from your JSON file (the `client_email` value)
   - Set permission: **Editor**
   - Click "Done"

### Without Proper Permissions

If the service account lacks permissions, you'll see this error in logs:
```
Error: The caller does not have permission
Status: 403 Forbidden
```

**Impact**:
- ✅ App still works correctly
- ✅ Signature validation still functions
- ❌ Cannot read cached evaluations
- ❌ Cannot write new evaluations
- ❌ Results in duplicate OpenAI API calls (increased costs)

### Environment Variables

```bash
# From your Google Sheet URL
GOOGLE_SHEET_ID=your-spreadsheet-id

# From your service account JSON file's "client_email" field
GOOGLE_CLIENT_EMAIL=your-project@your-project-id.iam.gserviceaccount.com

# From your service account JSON file's "private_key" field (keep the 
 characters)
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
"
```

**How to Get Service Account Credentials:**
1. Go to Google Cloud Console: https://console.cloud.google.com
2. Select your project (or create one)
3. Navigate to "IAM & Admin" → "Service Accounts"
4. Create a service account (or select existing)
5. Generate a JSON key
6. Download the JSON file - it contains both `client_email` and `private_key`

## 🔧 Troubleshooting

**Widget Not Loading?**
- Check Fly.io logs: `flyctl logs`
- Verify your API keys are set: `flyctl secrets list`

**"No conversation ID found"?**
- Help Scout might need a few minutes to propagate the integration
- Try refreshing the ticket page

**Signature Validation Failures?**

*Error: "Signature validation failed: length mismatch"*
- **Cause**: Wrong algorithm being used (SHA256 instead of SHA1)
- **Expected**: 28-character signatures for SHA1 (e.g., `E6Fa3PPJBwgrJhklyA3quasHiMY=`)
- **Solution**: Verify `server-final.js` uses `crypto.createHmac('sha1', secret)` not `'sha256'`

*Error: "X-HelpScout-Signature header missing"*
- **Cause**: Request not coming from Help Scout or local testing without signature
- **Solution**: For local testing, set `DISABLE_SIGNATURE_VALIDATION=true` in `.env`

*Error: "HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY not configured"*
- **Cause**: Secret key not set in environment
- **Solution**: `flyctl secrets set HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY="your-secret"`

*401 Unauthorized Response*
- **Cause**: Invalid signature - secret key mismatch
- **Solution**: 
  1. Check secret key in Help Scout app settings matches Fly.io secrets
  2. Use `node test-signature.js` to generate valid test signatures
  3. Check logs for signature comparison details

**Testing Signature Validation Locally:**

1. Get your secret from Help Scout app settings
2. Add to `.env`:
   ```
   HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY=your-secret-here
   ```
3. Run test utility:
   ```bash
   node test-signature.js
   ```
4. Use generated signature in Postman:
   - Method: POST
   - URL: http://localhost:8080/
   - Headers: `X-HelpScout-Signature: {generated-signature}`
   - Body: Use exact JSON from test script

**Google Sheets Permission Errors?**
- Error: "The caller does not have permission"
- **Cause**: Service account not shared with Google Sheet
- **Solution**: Share sheet with your service account email (from `client_email` field in Google Cloud JSON file) with Editor permission
- **How to find email**: Open your service account JSON file → look for `"client_email"` field
- **Impact if not fixed**: App works but makes duplicate OpenAI API calls (higher costs)

**OpenAI API Errors?**
- Ensure your new API key is valid and has credits
- Check you've set it correctly: `flyctl secrets list`

**Help Scout API Errors?**
- Verify your Help Scout access token is correct
- Check the app has proper permissions in Help Scout settings

## 💰 Costs

**Fly.io**: Likely free (small app, minimal usage)
**OpenAI**: ~$0.01-0.05 per evaluation (very low cost)

## 🔄 Making Updates

To update your widget:
1. Make changes to your files
2. Update the GitHub repository
3. Run `flyctl deploy` to redeploy

## 📞 Need Help?

If you get stuck:
1. Check Fly.io logs: `flyctl logs`
2. Check the browser console in Help Scout for JavaScript errors
3. Verify all API keys are correctly set

Your widget should now be working! It will automatically evaluate team responses and provide feedback based on your support tone guidelines.