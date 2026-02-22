import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type BskyPost = {
  uri: string;
  cid: string;
  author: { handle: string; displayName?: string };
  record: { text: string; createdAt: string };
  indexedAt: string;
};

type BskyFeedResponse = {
  feed: Array<{ post: BskyPost }>;
  cursor?: string;
};

/**
 * GET /api/bluesky?handle=alice.bsky.social&keyword=bitcoin&since=2024-01-01T00:00:00Z
 *
 * Fetches recent posts from a BlueSky user's feed and filters for a keyword.
 * Uses the public AT Protocol API — no auth required.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const handle = searchParams.get("handle");
  const keyword = searchParams.get("keyword");
  const since = searchParams.get("since"); // ISO timestamp — only return posts after this

  if (!handle) {
    return NextResponse.json({ error: "Missing handle parameter" }, { status: 400 });
  }
  if (!keyword) {
    return NextResponse.json({ error: "Missing keyword parameter" }, { status: 400 });
  }

  try {
    const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed");
    url.searchParams.set("actor", handle);
    url.searchParams.set("limit", "30");
    url.searchParams.set("filter", "posts_no_replies");

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BlueSky API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as BskyFeedResponse;

    const kw = keyword.toLowerCase();
    const sinceDate = since ? new Date(since).getTime() : 0;

    const matched = data.feed
      .filter((item) => {
        const postDate = new Date(item.post.record.createdAt).getTime();
        if (sinceDate && postDate <= sinceDate) return false;
        return item.post.record.text.toLowerCase().includes(kw);
      })
      .map((item) => ({
        text: item.post.record.text,
        uri: item.post.uri,
        createdAt: item.post.record.createdAt,
        authorHandle: item.post.author.handle,
        authorName: item.post.author.displayName,
      }));

    return NextResponse.json({
      posts: matched,
      matched: matched.length > 0,
      totalChecked: data.feed.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
