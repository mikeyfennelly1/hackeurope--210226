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
  }

  write(keyName: string, value: boolean): void {
    if (!this.buffer.has(keyName)) {
      throw new Error(`Key "${keyName}" does not exist in decision buffer`);
    }
    if (this.buffer.get(keyName) === null) {
      this.buffer.set(keyName, value);
      this.populatedCount++;
    }
  }

  isDecideable(): boolean {
    return this.populatedCount === this.keys.length;
  }

  isExpired(): boolean {
    return Date.now() > this.evictAt.getTime();
  }

  toRecord(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [key, value] of this.buffer) {
      if (value !== null) {
        result[key] = value;
      }
    }
    return result;
  }
}
