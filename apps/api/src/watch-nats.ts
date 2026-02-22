import { connect, StringCodec } from "nats";

async function main() {
  const nc = await connect({ servers: "localhost:4222" });
  const sc = StringCodec();

  console.log("🔌 Connected to NATS");
  console.log("👀 Watching ALL topics\n");

  // Subscribe to all topics
  const sub = nc.subscribe(">");

  for await (const msg of sub) {
    const subject = msg.subject;
    const data = sc.decode(msg.data);
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
    console.log(`[${timestamp}] 📨 ${subject}`);
    console.log(`           ${data}\n`);
  }
}

main().catch(console.error);
