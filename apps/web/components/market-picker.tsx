"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type PolymarketEvent = {
  question: string;
  title: string;
  slug: string;
  image: string;
  yesTokenId: string;
  noTokenId: string;
  volume24hr: number;
};

export function MarketPicker({
  value,
  onSelect,
  selectedTitle,
  selectedImage,
}: {
  value: string;
  onSelect: (event: { slug: string; title: string; image: string; yesTokenId: string; noTokenId: string }) => void;
  selectedTitle?: string;
  selectedImage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEvents = useCallback(() => {
    if (events.length > 0 || loading) return;
    setLoading(true);
    fetch("/api/polymarket?top=50")
      .then((res) => res.json())
      .then((data) => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [events.length, loading]);

  // Fetch on first open
  useEffect(() => {
    if (open) fetchEvents();
  }, [open, fetchEvents]);

  const selected = events.find((e) => e.slug === value);
  const displayTitle = selected?.title ?? selectedTitle;
  const displayImage = selected?.image ?? selectedImage;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-7 w-72 items-center justify-between border border-white/10 bg-[#0a0a0a] px-2 text-left text-[11px] text-white/80 outline-none transition-colors hover:border-white/20"
        >
          {displayTitle ? (
            <span className="flex items-center gap-2 overflow-hidden">
              {displayImage && (
                <img
                  src={displayImage}
                  alt=""
                  className="size-4 shrink-0 rounded-sm object-cover"
                />
              )}
              <span className="truncate">{displayTitle}</span>
            </span>
          ) : (
            <span className="text-white/30">
              {value || "Select market..."}
            </span>
          )}
          <ChevronsUpDown className="ml-1 size-3 shrink-0 text-white/30" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 border-white/10 bg-[#111314] p-0 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        align="start"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Command className="bg-transparent">
          <CommandInput
            placeholder="Search markets..."
            className="h-8 text-[11px]"
          />
          <CommandList className="max-h-60">
            <CommandEmpty className="py-3 text-center text-[11px] text-white/30">
              {loading ? "Loading markets..." : "No markets found"}
            </CommandEmpty>
            <CommandGroup>
              {events.map((event) => (
                <CommandItem
                  key={event.slug}
                  value={event.title}
                  onSelect={() => {
                    onSelect({ slug: event.slug, title: event.title, image: event.image, yesTokenId: event.yesTokenId, noTokenId: event.noTokenId });
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 data-[selected=true]:bg-white/5 data-[selected=true]:text-white/80"
                >
                  <img
                    src={event.image}
                    alt=""
                    className="size-5 shrink-0 rounded-sm object-cover"
                  />
                  <span className="truncate">{event.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
