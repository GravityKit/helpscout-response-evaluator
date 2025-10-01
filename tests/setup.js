// Jest setup file
// Set environment to test
process.env.NODE_ENV = 'test';

// Disable signature validation for tests
process.env.DISABLE_SIGNATURE_VALIDATION = 'true';

// Mock environment variables for tests
process.env.PORT = '8081';
process.env.OPENAI_API_KEY = 'test-key';
process.env.OPENAI_MODEL = 'gpt-4';
process.env.HELPSCOUT_APP_ID = 'test-app-id';
process.env.HELPSCOUT_APP_SECRET = 'test-app-secret';
process.env.HELPSCOUT_DYNAMIC_WIDGET_SECRET_KEY = 'test-secret';

// Suppress console output during tests (except errors)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};
