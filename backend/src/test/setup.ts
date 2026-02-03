// Set required environment variables for tests
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.SLA_THRESHOLD_HOURS = '8';
process.env.NODE_ENV = 'test';
