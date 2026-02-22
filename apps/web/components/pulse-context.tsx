"use client";

import { createContext, useCallback, useContext, useState } from "react";

const PULSE_DURATION_MS = 600;

type PulseContextValue = {
  pulsingNodes: ReadonlyMap<string, number>;
  pulseNode: (nodeId: string) => void;
};

const PulseContext = createContext<PulseContextValue>({
  pulsingNodes: new Map(),
  pulseNode: () => {},
});

export function PulseProvider({ children }: { children: React.ReactNode }) {
  const [pulsingNodes, setPulsingNodes] = useState<ReadonlyMap<string, number>>(new Map());

  const pulseNode = useCallback((nodeId: string) => {
    setPulsingNodes((prev) => {
      if (prev.has(nodeId)) return prev;
      const next = new Map(prev);
      next.set(nodeId, Date.now());
      return next;
    });
    setTimeout(() => {
      setPulsingNodes((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
    }, PULSE_DURATION_MS);
  }, []);

  return (
    <PulseContext.Provider value={{ pulsingNodes, pulseNode }}>
      {children}
    </PulseContext.Provider>
  );
}

export function usePulse() {
  return useContext(PulseContext);
}
