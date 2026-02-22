import { EventEmitter } from "node:events";

export type XMonitorCondition = {
  monitorType: "keyword_match" | "sentiment_analysis" | "account_monitor";
  account?: string;
  keywords?: string[];
  sentimentTarget?: "positive" | "negative";
  topic?: string;
  pollIntervalSeconds?: number;
};

const DEMO_DELAY_MS = 30_000;

/**
 * Demo X Monitor — simulates tweet detection.
 * Fires condition_met after 30 seconds with a fake tweet matching the config.
 * Emits "tweet" and "condition_met" just like the real implementation.
 */
export class XMonitor extends EventEmitter {
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly condition: XMonitorCondition) {
    super();
  }

  start(): void {
    if (this.closed) return;

    const account = this.condition.account ?? "unknown";
    console.log(
      `[XMonitor] Demo mode — will fire in ${DEMO_DELAY_MS / 1000}s for @${account}`,
    );

    this.timer = setTimeout(() => {
      if (this.closed) return;

      const text = this.buildFakeTweet();
      console.log(
        `[XMonitor] Simulated tweet from @${account}: "${text}"`,
      );

      this.emit("tweet", { text, author: account });
      this.emit("condition_met", { text, output: true });
      this.close();
    }, DEMO_DELAY_MS);
  }

  close(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private buildFakeTweet(): string {
    const account = this.condition.account ?? "someone";

    switch (this.condition.monitorType) {
      case "keyword_match": {
        const kw = this.condition.keywords?.[0] ?? "breaking news";
        return `Just posted about ${kw}! This is going to be huge.`;
      }
      case "sentiment_analysis": {
        const sentiment = this.condition.sentimentTarget ?? "positive";
        return sentiment === "positive"
          ? `Great news! Things are looking really good today.`
          : `This is terrible. Markets are in freefall.`;
      }
      case "account_monitor": {
        const topic = this.condition.topic;
        return topic
          ? `New update on ${topic} — more details to follow.`
          : `New post from @${account}.`;
      }
      default:
        return `New tweet from @${account}.`;
    }
  }
}
