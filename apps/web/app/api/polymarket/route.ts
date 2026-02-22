import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  const tokenId = request.nextUrl.searchParams.get("tokenId");

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
