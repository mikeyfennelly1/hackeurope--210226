/**
 * Environment variable validation and configuration
 * Fails fast if required variables are missing in non-test environments
 */

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value && process.env.NODE_ENV !== "test") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || "";
}

function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config = {
  port: parseInt(getOptionalEnv("PORT", "3001"), 10),
  nodeEnv: getOptionalEnv("NODE_ENV", "development"),

  polymarket: {
    get privateKey() {
      return getRequiredEnv("POLYMARKET_PRIVATE_KEY");
    },
    get apiKey() {
      return getRequiredEnv("POLYMARKET_API_KEY");
    },
    get apiSecret() {
      return getRequiredEnv("POLYMARKET_API_SECRET");
    },
    get apiPassphrase() {
      return getRequiredEnv("POLYMARKET_API_PASSPHRASE");
    },
    get funderAddress() {
      return getRequiredEnv("POLYMARKET_FUNDER_ADDRESS");
    },
    chainId: parseInt(getOptionalEnv("POLYMARKET_CHAIN_ID", "137"), 10),
    clobHost: getOptionalEnv(
      "POLYMARKET_CLOB_HOST",
      "https://clob.polymarket.com"
    ),
  },

  isDevelopment: () => config.nodeEnv === "development",
  isProduction: () => config.nodeEnv === "production",
  isTest: () => config.nodeEnv === "test",
} as const;
