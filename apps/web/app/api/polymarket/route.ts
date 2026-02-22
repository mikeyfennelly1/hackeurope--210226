import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  const tokenId = request.nextUrl.searchParams.get("tokenId");
  const top = request.nextUrl.searchParams.get("top");

  // Top markets endpoint
  if (top) {
    const limit = parseInt(top, 10) || 10;
    const res = await fetch(
      `https://gamma-api.polymarket.com/markets?limit=${limit}&order=volume24hr&ascending=false&closed=false`,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `GAMMA API returned ${res.status}` },
        { status: res.status },
      );
    }
    const markets = await res.json();
    // Transform to simpler format with parsed token IDs
    const simplified = markets
      .filter((m: { clobTokenIds?: string }) => m.clobTokenIds)
      .map((m: { question: string; clobTokenIds: string; volume24hr?: number }) => {
        const tokenIds = JSON.parse(m.clobTokenIds) as string[];
        return {
          question: m.question,
          yesTokenId: tokenIds[0],
          noTokenId: tokenIds[1],
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
