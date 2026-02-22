"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const PULSE_DURATION_MS = 600;

export type PulseEntry = { key: number; correlationId: number };

type PulseContextValue = {
  pulsingNodes: ReadonlyMap<string, PulseEntry[]>;
  pulseNode: (nodeId: string, correlationId?: number) => void;
  nodeValues: Record<string, number>;
  setNodeValue: (nodeId: string, value: number) => void;
};

const PulseContext = createContext<PulseContextValue>({
  pulsingNodes: new Map(),
  pulseNode: () => {},
  nodeValues: {},
  setNodeValue: () => {},
});

export function PulseProvider({ children }: { children: React.ReactNode }) {
  const [pulsingNodes, setPulsingNodes] = useState<ReadonlyMap<string, PulseEntry[]>>(new Map());
  const [nodeValues, setNodeValues] = useState<Record<string, number>>({});
  const counterRef = useRef(0);

  const pulseNode = useCallback((nodeId: string, correlationId?: number) => {
    const key = ++counterRef.current;
    const entry: PulseEntry = { key, correlationId: correlationId ?? key };
    setPulsingNodes((prev) => {
      const next = new Map(prev);
      const existing = next.get(nodeId) ?? [];
      next.set(nodeId, [...existing, entry]);
      return next;
    });
    setTimeout(() => {
      setPulsingNodes((prev) => {
        const existing = prev.get(nodeId);
        if (!existing) return prev;
        const filtered = existing.filter((e) => e.key !== key);
        const next = new Map(prev);
        if (filtered.length === 0) {
          next.delete(nodeId);
        } else {
          next.set(nodeId, filtered);
        }
        return next;
      });
    }, PULSE_DURATION_MS);
  }, []);

  const setNodeValue = useCallback((nodeId: string, value: number) => {
    setNodeValues((prev) => {
      if (prev[nodeId] === value) return prev;
      return { ...prev, [nodeId]: value };
    });
  }, []);

  return (
    <PulseContext.Provider value={{ pulsingNodes, pulseNode, nodeValues, setNodeValue }}>
      {children}
    </PulseContext.Provider>
  );
}

export function usePulse() {
  return useContext(PulseContext);
}
