const cache = new Map<string, { data: unknown; timestamp: number }>();

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/** Synchronously check if a URL has a valid cache entry. */
export function peekCache(url: string, ttl = DEFAULT_TTL): boolean {
  const entry = cache.get(url);
  return !!entry && Date.now() - entry.timestamp < ttl;
}

export async function cachedFetch<T = unknown>(
  url: string,
  ttl = DEFAULT_TTL,
): Promise<T> {
  const entry = cache.get(url);
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data as T;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache.set(url, { data, timestamp: Date.now() });
  return data as T;
}
