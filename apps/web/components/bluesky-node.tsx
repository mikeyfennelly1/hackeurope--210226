"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import type { FlowNodeData } from "./blueprint-studio";
import { usePulse } from "./pulse-context";

const BLUESKY_OUTPUT_HANDLES = [
  { id: "matched", label: "MATCHED" },
] as const;

export const BLUESKY_OUTPUT_IDS = BLUESKY_OUTPUT_HANDLES.map((h) => h.id);

type MatchedPost = {
  text: string;
  uri: string;
  createdAt: string;
  authorHandle: string;
  authorName?: string;
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "polling"; lastMatch?: MatchedPost; matchCount: number };

const POLL_OPTIONS = [
  { label: "1S", ms: 1000 },
  { label: "30S", ms: 30000 },
  { label: "1M", ms: 60000 },
  { label: "5M", ms: 300000 },
] as const;

export function BlueskyNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "inputNode">>) {
  const { pulseNode, setNodeValue, pushRedprintNode } = usePulse();
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sinceRef = useRef<string | null>(null);

  const handle = data.blueskyKeywordConfig?.handle ?? "";
  const keyword = data.blueskyKeywordConfig?.keyword ?? "";
  const pollIntervalMs = data.blueskyKeywordConfig?.pollIntervalMs ?? 60000;

  const pollBluesky = useCallback(async (bskyHandle: string, kw: string) => {
    if (!bskyHandle.trim() || !kw.trim()) {
      setFetchState({ status: "idle" });
      return;
    }

    setFetchState((prev) =>
      prev.status === "idle" || prev.status === "error"
        ? { status: "loading" }
        : prev,
    );

    try {
      const params = new URLSearchParams({ handle: bskyHandle, keyword: kw });
      if (sinceRef.current) params.set("since", sinceRef.current);

      const resp = await fetch(`/api/bluesky?${params.toString()}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }

      const result = await resp.json() as {
        posts: MatchedPost[];
        matched: boolean;
        totalChecked: number;
      };

      if (result.matched && result.posts.length > 0) {
        const latest = result.posts[0]!;
        sinceRef.current = latest.createdAt;

        setFetchState((prev) => ({
          status: "polling" as const,
          lastMatch: latest,
          matchCount: (prev.status === "polling" ? prev.matchCount : 0) + result.posts.length,
        }));

        // Fire downstream — setNodeValue expects a number; use 1 for "matched"
        setNodeValue(id, 1);
        setNodeValue(`${id}:matched`, 1);
        pulseNode(id);
        // Also fire in the running Redprint backend (if any)
        pushRedprintNode(id);
      } else {
        setFetchState((prev) =>
          prev.status === "polling"
            ? prev
            : { status: "polling", matchCount: 0 },
        );
      }
    } catch (err) {
      setFetchState({
        status: "error",
        message: err instanceof Error ? err.message.toUpperCase() : "FETCH FAILED",
      });
    }
  }, [id, setNodeValue, pulseNode, pushRedprintNode]);

  // Initial fetch + periodic polling
  useEffect(() => {
    if (!handle.trim() || !keyword.trim()) {
      setFetchState({ status: "idle" });
      return;
    }

    // Reset cursor on config change
    sinceRef.current = new Date().toISOString();

    pollBluesky(handle, keyword);

    timerRef.current = setInterval(() => {
      pollBluesky(handle, keyword);
    }, pollIntervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [handle, keyword, pollIntervalMs, pollBluesky]);

  return (
    <div className="relative w-[260px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner brackets */}
      <div className={`absolute h-3 w-3 border-l border-t border-[#d4602c] transition-all ${selected ? "-left-1.5 -top-1.5" : "-left-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-r border-t border-[#d4602c] transition-all ${selected ? "-right-1.5 -top-1.5" : "-right-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-l border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -left-1.5" : "-bottom-px -left-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-r border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -right-1.5" : "-bottom-px -right-px"}`} />

      {/* Noise overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "128px 128px",
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-[#0085ff]" />
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/60">
            BlueSky
          </span>
        </div>
        {fetchState.status === "loading" && (
          <Loader2 className="size-3 animate-spin text-[#0085ff]/60" />
        )}
        {fetchState.status === "polling" && (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#0085ff] opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#0085ff]" />
          </span>
        )}
      </div>

      {/* Label */}
      <div className="border-b border-white/10 px-3 py-1.5">
        <div className="text-[11px] font-medium text-white/80">
          {data.label || "BlueSky Monitor"}
        </div>
      </div>

      {/* Config display */}
      {handle && (
        <div className="border-b border-white/10 px-3 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">HANDLE</span>
            <span className="text-[9px] text-[#0085ff]/80">@{handle}</span>
          </div>
          {keyword && (
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">KEYWORD</span>
              <span className="text-[9px] text-white/50">&quot;{keyword}&quot;</span>
            </div>
          )}
        </div>
      )}

      {/* Idle state */}
      {fetchState.status === "idle" && (
        <div className="px-3 py-6 text-center">
          <div className="text-[9px] uppercase tracking-[0.3em] text-white/20">
            AWAITING CONFIG
          </div>
        </div>
      )}

      {/* Error state */}
      {fetchState.status === "error" && (
        <div className="px-3 py-3">
          <div className="border border-[#d4602c]/30 bg-[#d4602c]/5 px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#d4602c]">
              ERR /// {fetchState.message}
            </span>
          </div>
        </div>
      )}

      {/* Last matched post */}
      {fetchState.status === "polling" && fetchState.lastMatch && (
        <div className="border-b border-white/[0.06] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">LAST MATCH</span>
            <span className="text-[8px] tabular-nums text-white/25">
              {fetchState.matchCount} hit{fetchState.matchCount !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-white/40">
            {fetchState.lastMatch.text}
          </p>
        </div>
      )}

      {/* Poll interval display */}
      {handle && keyword && (
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
          <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">POLL</span>
          <span className="text-[8px] tabular-nums text-white/30">
            {POLL_OPTIONS.find((o) => o.ms === pollIntervalMs)?.label ?? `${pollIntervalMs / 1000}s`}
          </span>
        </div>
      )}

      {/* Output sockets */}
      <div>
        {BLUESKY_OUTPUT_HANDLES.map((output) => (
          <div
            key={output.id}
            className="relative flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5"
          >
            <span className="text-[9px] uppercase tracking-[0.15em] text-white/30">
              {output.label}
            </span>
            {fetchState.status === "polling" && fetchState.lastMatch && (
              <span className="mr-3 text-[10px] font-medium tabular-nums tracking-[0.05em] text-[#0085ff]/70">
                TRUE
              </span>
            )}
            <Handle
              id={output.id}
              type="source"
              position={Position.Right}
              style={{ top: "50%" }}
            />
          </div>
        ))}
      </div>

      {/* Scanlines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 3px)",
        }}
      />
    </div>
  );
}
