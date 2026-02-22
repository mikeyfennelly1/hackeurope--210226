"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { FlowNodeData } from "./blueprint-studio";

export function BlueskyMentionNode({
  data,
  selected,
}: NodeProps<Node<FlowNodeData, "inputNode">>) {
  const username = data.blueskyMentionConfig?.username ?? "";
  const keyword = data.blueskyMentionConfig?.keyword ?? "";
  const hasConfig = username.trim() !== "" && keyword.trim() !== "";

  return (
    <div className="relative w-[260px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner brackets */}
      <div
        className={`absolute h-3 w-3 border-l border-t border-[#0085ff] transition-all ${selected ? "-left-1.5 -top-1.5" : "-left-px -top-px"}`}
      />
      <div
        className={`absolute h-3 w-3 border-r border-t border-[#0085ff] transition-all ${selected ? "-right-1.5 -top-1.5" : "-right-px -top-px"}`}
      />
      <div
        className={`absolute h-3 w-3 border-b border-l border-[#0085ff] transition-all ${selected ? "-bottom-1.5 -left-1.5" : "-bottom-px -left-px"}`}
      />
      <div
        className={`absolute h-3 w-3 border-b border-r border-[#0085ff] transition-all ${selected ? "-bottom-1.5 -right-1.5" : "-bottom-px -right-px"}`}
      />

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
          <svg
            className="size-3.5"
            viewBox="0 0 568 501"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M123.121 33.6637C188.241 82.5526 258.281 181.681 284 234.873C309.719 181.681 379.759 82.5526 444.879 33.6637C491.866 -1.61183 568 -28.9064 568 57.9464C568 75.2916 557.574 219.837 551.617 243.372C531.368 323.787 460.742 345.609 397.303 334.767C505.76 353.761 530.291 418.556 473.363 483.351C365.067 607.308 307.644 403.879 289.935 347.309C287.135 339.069 285.818 334.959 284 334.959C282.182 334.959 280.865 339.069 278.065 347.309C260.356 403.879 202.933 607.308 94.6367 483.351C37.7085 418.556 62.2393 353.761 170.697 334.767C107.258 345.609 36.6317 323.787 16.3829 243.372C10.4261 219.837 0 75.2916 0 57.9464C0 -28.9064 76.1339 -1.61183 123.121 33.6637Z"
              fill="#0085ff"
            />
          </svg>
          <span className="text-[9px] uppercase tracking-[0.2em] text-white/60">
            Bluesky Monitor
          </span>
        </div>
        {hasConfig && (
          <div className="flex items-center gap-1">
            <div className="size-1.5 animate-pulse rounded-full bg-[#0085ff]" />
            <span className="text-[8px] uppercase tracking-[0.2em] text-[#0085ff]">
              MONITORING
            </span>
          </div>
        )}
      </div>

      {/* Idle state */}
      {!hasConfig && (
        <div className="px-3 py-6 text-center">
          <div className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/20">
            AWAITING CONFIG
          </div>
          <div className="mx-auto w-16 border-t border-dashed border-white/10" />
        </div>
      )}

      {/* Configured state */}
      {hasConfig && (
        <div>
          {/* Username */}
          <div className="border-b border-white/10 px-3 py-2">
            <div className="text-[8px] uppercase tracking-[0.3em] text-white/25">
              WATCHING
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-[#0085ff]">
              @{username}
            </div>
          </div>

          {/* Keyword */}
          <div className="px-3 py-2">
            <div className="text-[8px] uppercase tracking-[0.3em] text-white/25">
              KEYWORD
            </div>
            <div className="mt-0.5 text-[12px] text-white/70">
              &quot;{keyword}&quot;
            </div>
          </div>
        </div>
      )}

      {/* Scanlines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 3px)",
        }}
      />

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
