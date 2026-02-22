export interface OrderBookMarketParams {
  market: string;
  tick_size: string;
  neg_risk: boolean;
  min_order_size: string;
}

const MARKET_PARAMS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const marketParamsCache = new Map<
  string,
  { data: OrderBookMarketParams; expiry: number }
>();

const inflightRequests = new Map<string, Promise<OrderBookMarketParams | null>>();

/**
 * Fetch market parameters for a token from Polymarket CLOB.
 * Includes caching and request deduplication.
 */
export async function getMarketParams(
  tokenId: string
): Promise<OrderBookMarketParams | null> {
  const now = Date.now();

  // Lazy cleanup: remove expired entries
  for (const [key, cached] of marketParamsCache.entries()) {
    if (cached.expiry <= now) {
      marketParamsCache.delete(key);
    }
  }

  // Check cache for valid entry
  const cached = marketParamsCache.get(tokenId);
  if (cached) {
    return cached.data;
  }

  // Dedupe concurrent requests
  const inflight = inflightRequests.get(tokenId);
  if (inflight) {
    return inflight;
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(
        `https://clob.polymarket.com/book?token_id=${tokenId}`
      );

      if (!response.ok) {
        await response.text();
        return null;
      }

      const orderBook = (await response.json()) as OrderBookMarketParams;
      const params: OrderBookMarketParams = {
        market: orderBook.market,
        tick_size: orderBook.tick_size,
        neg_risk: orderBook.neg_risk,
        min_order_size: orderBook.min_order_size,
      };

      // Cache the result
      marketParamsCache.set(tokenId, {
        data: params,
        expiry: Date.now() + MARKET_PARAMS_CACHE_TTL_MS,
      });

      return params;
    } catch {
      return null;
    } finally {
      inflightRequests.delete(tokenId);
    }
  })();

  inflightRequests.set(tokenId, fetchPromise);
  return fetchPromise;
}
