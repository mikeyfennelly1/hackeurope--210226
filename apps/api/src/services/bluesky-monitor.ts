import { EventEmitter } from "node:events";
import { getLogger } from "../utils/logger.js";

export type BlueskyMentionConfig = {
  username: string;
  keyword: string;
};

/**
 * Polls the Bluesky public API every second to detect when a user
 * mentions a keyword. Emits "mention_found" on new matching posts
 * and "poll" on every cycle for UI feedback.
 */
export class BlueskyMentionMonitor extends EventEmitter {
  private interval: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly seen = new Set<string>();
  private firstPoll = true;
  private backoffDelay = 0;
  private readonly MAX_BACKOFF = 30_000;
  private readonly logger;

  constructor(private readonly config: BlueskyMentionConfig) {
    super();
    this.logger = getLogger(`BlueskyMention:${config.username}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(
      `Starting monitor for @${this.config.username} keyword="${this.config.keyword}"`,
    );

    this.interval = setInterval(() => {
      void this.poll();
    }, 1_000);
  }

  private async poll(): Promise<void> {
    if (this.closed) return;

    // Exponential backoff on errors
    if (this.backoffDelay > 0) {
      this.backoffDelay = Math.max(0, this.backoffDelay - 1_000);
      return;
    }

    try {
      const url = new URL(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts",
      );
      url.searchParams.set("q", this.config.keyword);
      url.searchParams.set("author", this.config.username);
      url.searchParams.set("limit", "5");
      url.searchParams.set("sort", "latest");

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        posts?: Array<{
          uri: string;
          record?: { text?: string };
        }>;
      };

      const posts = data.posts ?? [];

      // On first poll, seed the seen set to avoid triggering on old posts
      if (this.firstPoll) {
        for (const post of posts) {
          this.seen.add(post.uri);
        }
        this.firstPoll = false;
        this.logger.info(
          `Seeded ${this.seen.size} existing post(s) — now watching`,
        );
      } else {
        for (const post of posts) {
          if (!this.seen.has(post.uri)) {
            this.seen.add(post.uri);
            const text = post.record?.text ?? "";
            this.logger.info(`New mention found: "${text.slice(0, 80)}"`);
            this.emit("mention_found", { post, text });
          }
        }
      }

      // Emit poll event for UI feedback
      const latestText = posts[0]?.record?.text ?? "";
      this.emit("poll", { postCount: posts.length, latestText });

      // Reset backoff on success
      this.backoffDelay = 0;
    } catch (err) {
      this.logger.error(
        `Poll error: ${err instanceof Error ? err.message : "unknown"}`,
      );
      this.backoffDelay = Math.min(
        Math.max(this.backoffDelay * 2, 2_000),
        this.MAX_BACKOFF,
      );
    }
  }

  close(): void {
    this.closed = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
