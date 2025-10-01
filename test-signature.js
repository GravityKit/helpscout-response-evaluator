#!/usr/bin/env node

/**
 * Test script for Help Scout signature validation
 *
 * This demonstrates how Help Scout signatures work and allows testing
 * the validation logic locally.
 */

const crypto = require('crypto');

// Simulate Help Scout request
function generateSignature(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(body));
  return hmac.digest('base64');
}

// Test data
const testSecret = 'test-secret-key-12345';
const testBody = {
  ticket: {
    id: '123456',
    number: '789',
    subject: 'Test ticket'
  },
  customer: {
    id: '111',
    name: 'Test Customer'
  }
};

console.log('=== Help Scout Signature Validation Test ===\n');

// Generate valid signature
const validSignature = generateSignature(testBody, testSecret);
console.log('Test body:', JSON.stringify(testBody, null, 2));
console.log('\nSecret:', testSecret);
console.log('Generated signature:', validSignature);

// Test validation
console.log('\n--- Testing Validation Logic ---');

// Valid signature
const hmac1 = crypto.createHmac('sha256', testSecret);
hmac1.update(JSON.stringify(testBody));
const computed1 = hmac1.digest('base64');
const isValid1 = validSignature === computed1;
console.log('✓ Valid signature test:', isValid1 ? '✅ PASSED' : '❌ FAILED');

// Invalid signature
const invalidSignature = 'invalid-signature-xyz123';
const hmac2 = crypto.createHmac('sha256', testSecret);
hmac2.update(JSON.stringify(testBody));
const computed2 = hmac2.digest('base64');
const isValid2 = invalidSignature === computed2;
console.log('✓ Invalid signature test:', !isValid2 ? '✅ PASSED' : '❌ FAILED');

// Wrong secret
const wrongSecret = 'wrong-secret-key';
const hmac3 = crypto.createHmac('sha256', wrongSecret);
hmac3.update(JSON.stringify(testBody));
const computed3 = hmac3.digest('base64');
const isValid3 = validSignature === computed3;
console.log('✓ Wrong secret test:', !isValid3 ? '✅ PASSED' : '❌ FAILED');

// Timing-safe comparison test
console.log('\n--- Testing Timing-Safe Comparison ---');
try {
  const buf1 = Buffer.from(validSignature);
  const buf2 = Buffer.from(computed1);
  const isEqual = crypto.timingSafeEqual(buf1, buf2);
  console.log('✓ Timing-safe comparison:', isEqual ? '✅ PASSED' : '❌ FAILED');
} catch (error) {
  console.log('✓ Timing-safe comparison: ❌ FAILED -', error.message);
}

console.log('\n=== Test Complete ===');
console.log('\nTo use this with your app:');
console.log('1. Set HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY in your environment');
console.log('   (get this from your Help Scout app settings)');
console.log('2. Help Scout will send X-HelpScout-Signature header');
console.log('3. The app validates it using HMAC-SHA256\n');
