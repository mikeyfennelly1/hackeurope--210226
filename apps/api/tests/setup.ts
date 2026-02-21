// Mock environment variables for tests
process.env.NODE_ENV = "test";
process.env.PORT = "3001";
process.env.POLYMARKET_PRIVATE_KEY = "0x" + "a".repeat(64);
process.env.POLYMARKET_API_KEY = "test-api-key";
process.env.POLYMARKET_API_SECRET = "test-api-secret";
process.env.POLYMARKET_API_PASSPHRASE = "test-passphrase";
process.env.POLYMARKET_CHAIN_ID = "137";
