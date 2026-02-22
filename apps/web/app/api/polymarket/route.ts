import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  const tokenId = request.nextUrl.searchParams.get("tokenId");
  const top = request.nextUrl.searchParams.get("top");
  const query = request.nextUrl.searchParams.get("query");

  // Search events endpoint (returns events matching a text query)
  if (query) {
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10);
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?title=${encodeURIComponent(query)}&limit=${limit}&order=volume24hr&ascending=false&closed=false`,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `GAMMA API returned ${res.status}` },
        { status: res.status },
      );
    }
    const events = await res.json();
    const simplified = events
      .filter((e: { markets?: unknown[] }) => e.markets?.length)
      .map((e: { title: string; slug: string; image: string; markets: Array<{ question: string; clobTokenIds: string | string[]; outcomes: string | string[]; outcomePrices: string | string[] }> }) => {
        const m = e.markets[0]!;
        const tokenIds = typeof m.clobTokenIds === "string"
          ? (JSON.parse(m.clobTokenIds) as string[])
          : m.clobTokenIds;
        const outcomes = typeof m.outcomes === "string"
          ? (JSON.parse(m.outcomes) as string[])
          : m.outcomes;
        const prices = typeof m.outcomePrices === "string"
          ? (JSON.parse(m.outcomePrices) as string[])
          : m.outcomePrices;
        const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        const noIdx = yesIdx === 0 ? 1 : 0;
        return {
          title: e.title,
          slug: e.slug,
          question: m.question,
          yesTokenId: tokenIds[yesIdx >= 0 ? yesIdx : 0],
          noTokenId: tokenIds[noIdx],
          yesPrice: prices?.[yesIdx >= 0 ? yesIdx : 0],
          noPrice: prices?.[noIdx],
          numMarkets: e.markets.length,
        };
      });
    return NextResponse.json(simplified);
  }

  // Top events endpoint (returns events with image, slug, title)
  if (top) {
    const limit = parseInt(top, 10) || 10;
    const res = await fetch(
      `https://gamma-api.polymarket.com/events?limit=${limit}&order=volume24hr&ascending=false&closed=false`,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `GAMMA API returned ${res.status}` },
        { status: res.status },
      );
    }
    const events = await res.json();
    const simplified = events
      .filter((e: { markets?: unknown[] }) => e.markets?.length)
      .map((e: { title: string; slug: string; image: string; volume: number; markets: Array<{ question: string; clobTokenIds: string | string[]; outcomes: string | string[]; volume24hr?: number }> }) => {
        const m = e.markets[0]!;
        const tokenIds = typeof m.clobTokenIds === "string"
          ? (JSON.parse(m.clobTokenIds) as string[])
          : m.clobTokenIds;
        const outcomes = typeof m.outcomes === "string"
          ? (JSON.parse(m.outcomes) as string[])
          : m.outcomes;
        const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        const noIdx = yesIdx === 0 ? 1 : 0;
        return {
          question: m.question,
          title: e.title,
          slug: e.slug,
          image: e.image,
          yesTokenId: tokenIds[yesIdx >= 0 ? yesIdx : 0],
          noTokenId: tokenIds[noIdx],
          volume24hr: m.volume24hr,
        };
      });
    return NextResponse.json(simplified);
  }

  // Price history endpoint
  if (tokenId) {
    const interval = request.nextUrl.searchParams.get("interval") ?? "all";
    const fidelity = request.nextUrl.searchParams.get("fidelity") ?? "60";
    const res = await fetch(
      `https://clob.polymarket.com/prices-history?market=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(interval)}&fidelity=${encodeURIComponent(fidelity)}`,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `CLOB API returned ${res.status}` },
        { status: res.status },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  }

  // Event data endpoint
  if (!slug) {
    return NextResponse.json({ error: "Missing slug or tokenId parameter" }, { status: 400 });
  }

  const res = await fetch(
    `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`,
  );

  if (!res.ok) {
    return NextResponse.json(
      { error: `GAMMA API returned ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
