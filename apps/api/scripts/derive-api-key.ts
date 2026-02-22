/**
 * Script to derive/create Polymarket API credentials from a wallet private key.
 *
 * Usage: npx tsx scripts/derive-api-key.ts <PRIVATE_KEY>
 */

import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

async function deriveApiCredentials(privateKey: string) {
  console.log("Creating Polymarket API credentials...\n");

  const wallet = new Wallet(privateKey);
  console.log("Wallet address:", wallet.address);

  const client = new ClobClient(CLOB_HOST, CHAIN_ID, wallet);

  // Try different methods to get API credentials
  let creds: any;

  // First try to derive existing key
  console.log("Attempting to derive existing API key...");
  try {
    creds = await client.deriveApiKey();
    console.log("Derive response:", JSON.stringify(creds, null, 2));
  } catch (e: any) {
    console.log("Derive failed:", e.message);
  }

  // If derive failed or returned empty, try creating new key
  if (!creds || !creds.apiKey) {
    console.log("Attempting to create new API key...");
    try {
      creds = await client.createApiKey();
      console.log("Create response:", JSON.stringify(creds, null, 2));
    } catch (e: any) {
      console.log("Create failed:", e.message);
    }
  }

  // Try getting existing keys
  if (!creds || !creds.apiKey) {
    console.log("Attempting to get existing API keys...");
    try {
      const keys = await client.getApiKeys();
      console.log("Existing keys:", JSON.stringify(keys, null, 2));
      if (keys && keys.length > 0) {
        creds = keys[0];
      }
    } catch (e: any) {
      console.log("Get keys failed:", e.message);
    }
  }

  // Handle different response formats
  const apiKey = creds.apiKey || creds.key || creds.api_key;
  const secret = creds.secret || creds.apiSecret || creds.api_secret;
  const passphrase = creds.passphrase || creds.apiPassphrase || creds.api_passphrase;

  console.log("\n=== API Credentials ===\n");
  console.log("Add these to your .env file:\n");
  console.log(`POLYMARKET_PRIVATE_KEY=${privateKey}`);
  console.log(`POLYMARKET_API_KEY=${apiKey}`);
  console.log(`POLYMARKET_API_SECRET=${secret}`);
  console.log(`POLYMARKET_API_PASSPHRASE=${passphrase}`);
  console.log(`POLYMARKET_CHAIN_ID=${CHAIN_ID}`);

  return creds;
}

// Get private key from command line argument
const privateKey = process.argv[2];

if (!privateKey) {
  console.error("Usage: npx tsx scripts/derive-api-key.ts <PRIVATE_KEY>");
  console.error("\nExample: npx tsx scripts/derive-api-key.ts 0xabc123...");
  process.exit(1);
}

deriveApiCredentials(privateKey)
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error deriving credentials:", error.message);
    process.exit(1);
  });
