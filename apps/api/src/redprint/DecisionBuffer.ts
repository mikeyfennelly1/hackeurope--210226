import { getLogger } from "../utils/logger.js";

const logger = getLogger("DecisionBuffer");

export class DecisionBuffer {
  private readonly buffer: Map<string, boolean | null>;
  readonly keys: string[];
  private populatedCount: number;
  readonly evictAt: Date;

  constructor(producerNames: string[], ttlSeconds = 900) {
    this.buffer = new Map(producerNames.map((name) => [name, null]));
    this.keys = [...this.buffer.keys()];
    this.populatedCount = 0;
    this.evictAt = new Date(Date.now() + ttlSeconds * 1000);
    logger.debug(
      `Initialized with ${producerNames.length} key(s): [${producerNames.join(", ")}], ttl=${ttlSeconds}s, evictAt=${this.evictAt.toISOString()}`,
    );
  }

  write(keyName: string, value: boolean): void {
    if (!this.buffer.has(keyName)) {
      throw new Error(`Key "${keyName}" does not exist in decision buffer`);
    }
    if (this.buffer.get(keyName) === null) {
      this.buffer.set(keyName, value);
      this.populatedCount++;
      logger.trace(
        `Wrote key "${keyName}"=${value} (${this.populatedCount}/${this.keys.length} populated)`,
      );
      if (this.populatedCount === this.keys.length) {
        logger.debug("Buffer fully populated — decideable");
      }
    } else {
      logger.trace(`Skipped write for key "${keyName}" — already set`);
    }
  }

  isDecideable(): boolean {
    const decideable = this.populatedCount === this.keys.length;
    logger.trace(`isDecideable() → ${decideable} (${this.populatedCount}/${this.keys.length})`);
    return decideable;
  }

  isExpired(): boolean {
    const expired = Date.now() > this.evictAt.getTime();
    logger.trace(`isExpired() → ${expired} (evictAt=${this.evictAt.toISOString()})`);
    return expired;
  }

  toRecord(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [key, value] of this.buffer) {
      if (value !== null) {
        result[key] = value;
      }
    }
    logger.trace(`toRecord() → ${JSON.stringify(result)}`);
    return result;
  }
}
