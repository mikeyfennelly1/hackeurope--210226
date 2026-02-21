import { connect, type NatsConnection } from "nats";

let connection: NatsConnection | null = null;

export async function connectNats(): Promise<NatsConnection> {
  const servers = process.env.NATS_URL ?? "localhost:4222";
  connection = await connect({ servers });
  console.log(`Connected to NATS at ${servers}`);
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
