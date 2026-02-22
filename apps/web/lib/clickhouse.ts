import { createClient } from "@clickhouse/client";

let client: ReturnType<typeof createClient> | null = null;

export function getClickHouseClient() {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DATABASE ?? "default",
    });
  }
  return client;
}
