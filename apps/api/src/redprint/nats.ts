import { connect, type NatsConnection } from "nats";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("NATS");

let connection: NatsConnection | null = null;

export async function connectNats(): Promise<NatsConnection> {
  const servers = process.env.NATS_URL ?? "localhost:4222";
  logger.info(`Connecting to NATS at ${servers}...`);
  connection = await connect({ servers });
  logger.info(`Connected to NATS at ${servers}`);
  return connection;
}

export function getConnection(): NatsConnection {
  if (!connection) {
    throw new Error("NATS not connected. Call connectNats() first.");
  }
  return connection;
}

export async function closeNats(): Promise<void> {
  if (connection) {
    await connection.drain();
    connection = null;
  }
}
