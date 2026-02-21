"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  Background,
  ConnectionLineType,
  Controls,
  type Connection,
  type EdgeChange,
  type Edge,
  Handle,
  type NodeChange,
  type Node,
  type NodeProps,
  type OnConnectEnd,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
} from "@xyflow/react";
import {
  BlueprintBuilder,
  BlueprintUtils,
  toDefinition,
  type Blueprint,
  type Decision,
} from "@repo/backend/blueprints";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  Zap,
} from "lucide-react";

import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STORAGE_KEY = "blueprints:v1";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type FlowNodeType = "inputNode" | "outputNode" | "decisionNode";

type FlowNodeData = {
  label: string;
  inputs: string[];
  outputs: string[];
  action?: { verb: Decision; market_id: string };
  hasError?: boolean;
};

type RedprintNodeState = {
  name: string;
  label?: string;
  role: string;
  status: string;
  firedAt?: string;
};

type RedprintJSON = {
  id: string;
  name: string;
  status: string;
  nodes: RedprintNodeState[];
  decision?: { verb: string; market_id: string } | null;
  createdAt: string;
};

type ApiRedprintResponse = {
  id: string;
  blueprintName: string;
  status: string;
  nodes: Record<string, { label?: string; role: string; status: string; output: unknown; firedAt: string | null }>;
  decision: { verb: string; market_id: string } | null;
  createdAt: string;
};

function apiResponseToRedprint(raw: ApiRedprintResponse): RedprintJSON {
  return {
    id: raw.id,
    name: raw.blueprintName,
    status: raw.status,
    nodes: Object.entries(raw.nodes).map(([name, state]) => ({
      name,
      label: state.label,
      role: state.role,
      status: state.status,
      firedAt: state.firedAt ?? undefined,
    })),
    decision: raw.decision,
    createdAt: raw.createdAt,
  };
}

type BlueprintError = ReturnType<
  typeof BlueprintUtils.validate
>["errors"][number];

type ContextMenu =
  | { type: "pane"; screenX: number; screenY: number; flowX: number; flowY: number }
  | { type: "connection"; screenX: number; screenY: number; flowX: number; flowY: number; fromNodeId: string; fromHandleId: string | null; fromHandleType: "source" | "target" }
  | { type: "node"; screenX: number; screenY: number; nodeId: string };

const PHANTOM_NODE_ID = "__phantom__";
const PHANTOM_EDGE_ID = "__phantom_edge__";

function createStarterBlueprint(name: string): Blueprint {
  return new BlueprintBuilder(name)
    .addNode({
      id: "input-1",
      type: "input",
      label: "Input",
      position: { x: 80, y: 240 },
      inputs: [],
      outputs: ["topic.orders"],
    })
    .addNode({
      id: "decision-1",
      type: "decision",
      label: "Decision",
      position: { x: 400, y: 220 },
      inputs: ["topic.orders"],
      outputs: ["approved", "rejected"],
      action: { verb: "buy", market_id: "" },
    })
    .addNode({
      id: "output-1",
      type: "output",
      label: "Output",
      position: { x: 760, y: 240 },
      inputs: ["topic.orders"],
      outputs: [],
    })
    .addEdge({ id: "edge-1", source: "input-1", target: "decision-1" })
    .addEdge({ id: "edge-2", source: "decision-1", target: "output-1", sourceHandle: "approved" })
    .build();
}

function toFlowNodeType(
  type: Blueprint["nodes"][number]["type"],
): FlowNodeType {
  if (type === "input") return "inputNode";
  if (type === "output") return "outputNode";
  return "decisionNode";
}

function toBlueprintNodeType(
  type: FlowNodeType,
): Blueprint["nodes"][number]["type"] {
  if (type === "inputNode") return "input";
  if (type === "outputNode") return "output";
  return "decision";
}

function blueprintToFlow(blueprint: Blueprint): {
  nodes: Node<FlowNodeData, FlowNodeType>[];
  edges: Edge[];
} {
  return {
    nodes: blueprint.nodes.map((node) => ({
      id: node.id,
      type: toFlowNodeType(node.type),
      position: node.position,
      data: {
        label: node.label,
        inputs: [...node.inputs],
        outputs: [...node.outputs],
        action: node.action,
      },
    })),
    edges: blueprint.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: "smoothstep",
      animated: false,
    })),
  };
}

function flowToBlueprint(
  blueprint: Blueprint,
  nodes: Node<FlowNodeData, FlowNodeType>[],
  edges: Edge[],
): Blueprint {
  return {
    ...blueprint,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: toBlueprintNodeType(node.type ?? "outputNode"),
      label: node.data.label,
      position: node.position,
      inputs: [...node.data.inputs],
      outputs: [...node.data.outputs],
      ...(node.data.action ? { action: node.data.action } : {}),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    })),
  };
}

function saveBlueprints(blueprints: Blueprint[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blueprints));
}

function loadBlueprints(): Blueprint[] {
  if (typeof window === "undefined")
    return [createStarterBlueprint("Order Blueprint")];

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [createStarterBlueprint("Order Blueprint")];
  }

  try {
    const parsed = JSON.parse(stored) as Blueprint[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createStarterBlueprint("Order Blueprint")];
    }

    return parsed;
  } catch {
    return [createStarterBlueprint("Order Blueprint")];
  }
}

function BaseNode({
  label,
  icon,
  subtitle,
  hasError,
  children,
}: {
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  hasError?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-[200px] border bg-[#161a19] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${hasError ? "border-[#c45c5c]" : "border-white/10"}`}>
      <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[#8a918c]">{icon}</span>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#5c635e]">
            {subtitle}
          </p>
        </div>
      </div>
      <p className="mb-2 text-sm font-semibold text-[#e0e5e2]">{label}</p>
      {children}
    </div>
  );
}

function InputNode({ data }: NodeProps<Node<FlowNodeData, "inputNode">>) {
  return (
    <BaseNode
      label={data.label}
      subtitle="Input"
      icon={<Plus className="size-4" />}
      hasError={data.hasError}
    >
      <Handle type="source" position={Position.Right} />
      <p className="text-[11px] text-[#8a918c]">
        Publishes: {data.outputs.join(", ") || "none"}
      </p>
      <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
        Source
      </div>
    </BaseNode>
  );
}

function OutputNode({ data }: NodeProps<Node<FlowNodeData, "outputNode">>) {
  return (
    <BaseNode
      label={data.label}
      subtitle="Output"
      icon={<CheckCircle2 className="size-4" />}
      hasError={data.hasError}
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-[11px] text-[#8a918c]">
        Consumes: {data.inputs.join(", ") || "none"}
      </p>
      <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
        Sink
      </div>
    </BaseNode>
  );
}

function DecisionNode({ data }: NodeProps<Node<FlowNodeData, "decisionNode">>) {
  return (
    <BaseNode
      label={data.label}
      subtitle="Decision"
      icon={<GitBranch className="size-4" />}
      hasError={data.hasError}
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-[11px] text-[#8a918c]">
        Consumes: {data.inputs.join(", ") || "none"}
      </p>
      <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
        Branches
      </div>
      <div className="mt-1 space-y-1">
        {data.outputs.map((branch) => (
          <div
            key={branch}
            className="relative flex items-center rounded border border-white/10 px-2 py-1 text-[11px] text-[#c8ccc9]"
          >
            {branch}
            <Handle
              id={branch}
              type="source"
              position={Position.Right}
              style={{ top: "50%" }}
            />
          </div>
        ))}
      </div>
    </BaseNode>
  );
}

function PhantomNode() {
  return (
    <div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
    </div>
  );
}

function FloatingNodeToolbar({
  node,
  errors,
  onUpdate,
  onDelete,
}: {
  node: Node<FlowNodeData, FlowNodeType>;
  errors: BlueprintError[];
  onUpdate: (patch: Partial<FlowNodeData>) => void;
  onDelete: () => void;
}) {
  const { flowToScreenPosition, getNode } = useReactFlow();
  const { zoom } = useViewport();

  const internalNode = getNode(node.id);
  const nodeWidth = internalNode?.measured?.width ?? 200;
  const screenPos = flowToScreenPosition({
    x: node.position.x + nodeWidth / 2,
    y: node.position.y,
  });
  const nodeErrors = errors.filter((e) => e.nodeId === node.id);

  return (
    <div
      className="fixed z-50 flex flex-col items-center"
      style={{
        left: screenPos.x,
        top: screenPos.y,
        transform: `translate(-50%, -100%) scale(${zoom})`,
        transformOrigin: "center bottom",
        paddingBottom: 8,
      }}
    >
      {nodeErrors.length > 0 && (
        <div className="mb-1 space-y-1">
          {nodeErrors.map((error) => (
            <div
              key={`${error.code}-${error.nodeId ?? ""}`}
              className="rounded border border-[#8b4449]/60 bg-[#161a19] px-2 py-1 text-[10px] text-[#c45c5c]"
            >
              {error.message}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 border border-white/10 bg-[#161a19] px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <Input
          className="h-6 w-24 text-[11px]"
          value={node.data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Label"
        />
        <Input
          className="h-6 w-28 text-[11px]"
          value={node.data.inputs.join(", ")}
          onChange={(e) =>
            onUpdate({
              inputs: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="Inputs"
        />
        <Input
          className="h-6 w-28 text-[11px]"
          value={node.data.outputs.join(", ")}
          onChange={(e) =>
            onUpdate({
              outputs: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="Outputs"
        />
        <button
          onClick={onDelete}
          className="ml-0.5 text-[#8a918c] hover:text-[#c45c5c]"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {node.type === "decisionNode" && (
        <div className="mt-1 flex items-center gap-1.5 border border-white/10 bg-[#161a19] px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <select
            className="h-6 rounded border border-white/10 bg-[#1a1f1d] px-1.5 text-[11px] text-[#c8ccc9]"
            value={node.data.action?.verb ?? "buy"}
            onChange={(e) =>
              onUpdate({
                action: {
                  verb: e.target.value as Decision,
                  market_id: node.data.action?.market_id ?? "",
                },
              })
            }
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <Input
            className="h-6 w-36 text-[11px]"
            value={node.data.action?.market_id ?? ""}
            onChange={(e) =>
              onUpdate({
                action: {
                  verb: node.data.action?.verb ?? "buy",
                  market_id: e.target.value,
                },
              })
            }
            placeholder="Market ID"
          />
        </div>
      )}
    </div>
  );
}

type ConnectionInfo = {
  fromNodeId: string;
  fromHandleId: string | null;
  fromHandleType: "source" | "target";
};

const ALL_NODE_OPTIONS: { type: FlowNodeType; label: string; icon: React.ReactNode; hasTarget: boolean; hasSource: boolean }[] = [
  { type: "inputNode", label: "Input", icon: <Plus className="size-3 text-[#8a918c]" />, hasTarget: false, hasSource: true },
  { type: "decisionNode", label: "Decision", icon: <GitBranch className="size-3 text-[#8a918c]" />, hasTarget: true, hasSource: true },
  { type: "outputNode", label: "Output", icon: <CheckCircle2 className="size-3 text-[#8a918c]" />, hasTarget: true, hasSource: false },
];

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[#c8ccc9] hover:bg-white/5 transition-colors";

const MENU_CLASS =
  "fixed z-50 min-w-[140px] border border-white/10 bg-[#161a19] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]";

function ConnectionNodePicker({
  menu,
  onAddNode,
  onClose,
}: {
  menu: Extract<ContextMenu, { type: "connection" }>;
  onAddNode: (
    type: FlowNodeType,
    position: { x: number; y: number },
    connectFrom: ConnectionInfo,
  ) => void;
  onClose: () => void;
}) {
  // Subscribe to viewport so we re-render (and reposition) on pan/zoom
  useViewport();
  const { flowToScreenPosition } = useReactFlow();
  const screenPos = flowToScreenPosition({ x: menu.flowX, y: menu.flowY });

  const connectFrom: ConnectionInfo = {
    fromNodeId: menu.fromNodeId,
    fromHandleId: menu.fromHandleId,
    fromHandleType: menu.fromHandleType,
  };

  const options = ALL_NODE_OPTIONS.filter((opt) =>
    connectFrom.fromHandleType === "source" ? opt.hasTarget : opt.hasSource,
  );

  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      <div
        className={MENU_CLASS}
        style={{ left: screenPos.x, top: screenPos.y }}
      >
        <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
          Add Node
        </div>
        {options.map((opt) => (
          <button
            key={opt.type}
            className={ITEM_CLASS}
            onClick={() => {
              onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, connectFrom);
              onClose();
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CanvasContextMenu({
  menu,
  onAddNode,
  onDeleteNode,
  onClose,
}: {
  menu: Exclude<ContextMenu, { type: "connection" }>;
  onAddNode: (
    type: FlowNodeType,
    position: { x: number; y: number },
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  const [showAddSub, setShowAddSub] = useState(false);

  const nodeItems = (position: { x: number; y: number }) =>
    ALL_NODE_OPTIONS.map((opt) => (
      <button
        key={opt.type}
        className={ITEM_CLASS}
        onClick={() => {
          onAddNode(opt.type, position);
          onClose();
        }}
      >
        {opt.icon}
        {opt.label}
      </button>
    ));

  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      <div
        className={MENU_CLASS}
        style={{ left: menu.screenX, top: menu.screenY }}
      >
        {menu.type === "pane" ? (
          <div
            className="relative"
            onMouseEnter={() => setShowAddSub(true)}
            onMouseLeave={() => setShowAddSub(false)}
          >
            <button className={ITEM_CLASS}>
              <Plus className="size-3 text-[#8a918c]" />
              <span className="flex-1">Add node</span>
              <ChevronRight className="size-3 text-[#5c635e]" />
            </button>
            {showAddSub && (
              <div
                className={MENU_CLASS}
                style={{ position: "absolute", left: "100%", top: -5 }}
              >
                {nodeItems({ x: menu.flowX, y: menu.flowY })}
              </div>
            )}
          </div>
        ) : (
          <button
            className={ITEM_CLASS}
            onClick={() => {
              onDeleteNode(menu.nodeId);
              onClose();
            }}
          >
            <Trash2 className="size-3 text-[#8a918c]" />
            Delete node
          </button>
        )}
      </div>
    </div>
  );
}

function BlueprintStudioInner() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("");
  const [nodes, setNodes] = useState<Node<FlowNodeData, FlowNodeType>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [validationErrors, setValidationErrors] = useState<BlueprintError[]>(
    [],
  );
  const [status, setStatus] = useState<"saved" | "invalid">("saved");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [activeRedprint, setActiveRedprint] = useState<RedprintJSON | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const updateNodeInternals = useUpdateNodeInternals();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const skipNextPaneClickRef = useRef(false);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const screenToFlowPositionRef = useRef(screenToFlowPosition);
  screenToFlowPositionRef.current = screenToFlowPosition;

  const selectedBlueprint = useMemo(
    () => blueprints.find((item) => item.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId],
  );

  const errorNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const error of validationErrors) {
      if (error.nodeId) ids.add(error.nodeId);
    }
    return ids;
  }, [validationErrors]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          hasError: errorNodeIds.has(node.id),
        },
      })),
    [nodes, errorNodeIds],
  );

  useEffect(() => {
    const loaded = loadBlueprints();
    setBlueprints(loaded);
    setSelectedBlueprintId(loaded[0]?.id ?? "");
  }, []);

  useEffect(() => {
    const bp = blueprints.find((item) => item.id === selectedBlueprintId) ?? null;
    if (!bp) return;
    const flow = blueprintToFlow(bp);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    const result = BlueprintUtils.validate(bp);
    setValidationErrors(result.errors);
    setStatus(result.valid ? "saved" : "invalid");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync flow state when switching blueprints
  }, [selectedBlueprintId]);

  const persistCurrent = useCallback(
    (nextNodes: Node<FlowNodeData, FlowNodeType>[], nextEdges: Edge[]) => {
      if (!selectedBlueprint) return;

      const updated = flowToBlueprint(selectedBlueprint, nextNodes, nextEdges);
      const result = BlueprintUtils.validate(updated);
      setValidationErrors(result.errors);
      setStatus(result.valid ? "saved" : "invalid");

      setBlueprints((current) => {
        const next = current.map((item) =>
          item.id === updated.id ? updated : item,
        );
        if (result.valid) {
          saveBlueprints(next);
        }
        return next;
      });
    },
    [selectedBlueprint],
  );

  const persistRef = useRef(persistCurrent);
  persistRef.current = persistCurrent;

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData, FlowNodeType>>[]) => {
      // Ignore changes to the phantom node
      const filtered = changes.filter(
        (c) => !("id" in c && c.id === PHANTOM_NODE_ID),
      );
      if (filtered.length === 0) return;
      const next = applyNodeChanges(filtered, nodesRef.current);
      setNodes(next);
      nodesRef.current = next;
      const hasDataChange = filtered.some((c) => c.type !== "select");
      if (hasDataChange) {
        persistRef.current(next, edgesRef.current);
      }
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const filtered = changes.filter(
        (c) => !("id" in c && c.id === PHANTOM_EDGE_ID),
      );
      if (filtered.length === 0) return;
      const next = applyEdgeChanges(filtered, edgesRef.current);
      setEdges(next);
      edgesRef.current = next;
      persistRef.current(nodesRef.current, next);
    },
    [],
  );

  const dispatchBlueprint = async () => {
    if (!selectedBlueprint || status !== "saved") return;
    setDispatching(true);
    try {
      const definition = toDefinition(selectedBlueprint);
      const res = await fetch(`${API_URL}/api/redprints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(definition),
      });
      if (!res.ok) throw new Error(`Dispatch failed: ${res.status}`);
      const raw = (await res.json()) as ApiRedprintResponse;
      setActiveRedprint(apiResponseToRedprint(raw));
    } catch (err) {
      console.error("Dispatch error:", err);
    } finally {
      setDispatching(false);
    }
  };

  const pushEvent = async (nodeName: string) => {
    if (!activeRedprint) return;
    try {
      await fetch(
        `${API_URL}/api/redprints/${activeRedprint.id}/nodes/${nodeName}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output: true }),
        },
      );
    } catch (err) {
      console.error("Push event error:", err);
    }
  };

  const teardownRedprint = async () => {
    if (!activeRedprint) return;
    try {
      await fetch(`${API_URL}/api/redprints/${activeRedprint.id}`, {
        method: "DELETE",
      });
      setActiveRedprint(null);
    } catch (err) {
      console.error("Teardown error:", err);
    }
  };

  useEffect(() => {
    if (!activeRedprint || activeRedprint.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/redprints/${activeRedprint.id}`,
        );
        if (res.ok) {
          const raw = (await res.json()) as ApiRedprintResponse;
          setActiveRedprint(apiResponseToRedprint(raw));
        }
      } catch {
        /* ignore polling errors */
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRedprint?.id, activeRedprint?.status]);

  const addNodeByType = (
    type: FlowNodeType,
    atPosition?: { x: number; y: number },
    connectFrom?: ConnectionInfo,
  ) => {
    let position: { x: number; y: number };

    if (atPosition) {
      position = atPosition;
    } else {
      const flowElement = document.querySelector(
        ".react-flow",
      ) as HTMLElement | null;
      const fallbackX = window.innerWidth / 2;
      const fallbackY = window.innerHeight / 2;
      const bounds = flowElement?.getBoundingClientRect();
      const center = screenToFlowPosition({
        x: bounds ? bounds.left + bounds.width / 2 : fallbackX,
        y: bounds ? bounds.top + bounds.height / 2 : fallbackY,
      });
      const anchor = nodes[nodes.length - 1];
      position = anchor
        ? { x: anchor.position.x + 260, y: anchor.position.y + 24 }
        : { x: center.x, y: center.y };
    }

    const id = `${type}-${Date.now()}`;
    const node: Node<FlowNodeData, FlowNodeType> = {
      id,
      type,
      position,
      data: {
        label:
          type === "decisionNode"
            ? "New Decision"
            : type === "inputNode"
              ? "New Input"
              : "New Output",
        inputs: type === "inputNode" ? [] : ["topic.orders"],
        outputs:
          type === "decisionNode"
            ? ["branch-a", "branch-b"]
            : type === "outputNode"
              ? []
              : ["topic.orders"],
      },
    };

    const nextNodes = [...nodes, node];
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    setSelectedNodeId(id);

    let nextEdges = edgesRef.current;
    if (connectFrom) {
      // Dragged from a source handle → new node is the target
      // Dragged from a target handle → new node is the source
      const edge: Edge =
        connectFrom.fromHandleType === "source"
          ? {
              id: `edge-${Date.now()}`,
              source: connectFrom.fromNodeId,
              target: id,
              sourceHandle: connectFrom.fromHandleId,
              type: "smoothstep",
            }
          : {
              id: `edge-${Date.now()}`,
              source: id,
              target: connectFrom.fromNodeId,
              targetHandle: connectFrom.fromHandleId,
              type: "smoothstep",
            };
      nextEdges = addEdge(edge, edgesRef.current);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
    }

    persistCurrent(nextNodes, nextEdges);
    requestAnimationFrame(() => {
      fitView({ duration: 260, padding: 0.24 });
    });
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      ) {
        return;
      }

      const sourceNode = nodesRef.current.find((node) => node.id === connection.source);
      if (sourceNode?.type === "decisionNode" && !connection.sourceHandle) {
        return;
      }

      const nextEdges = addEdge(
        {
          ...connection,
          id: `edge-${Date.now()}`,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
          type: "smoothstep",
        },
        edgesRef.current,
      );
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
      persistRef.current(nodesRef.current, nextEdges);
    },
    [],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.toNode) return;
      if (!connectionState.fromNode) return;

      const clientX = "changedTouches" in event ? (event.changedTouches[0]?.clientX ?? 0) : event.clientX;
      const clientY = "changedTouches" in event ? (event.changedTouches[0]?.clientY ?? 0) : event.clientY;
      const flowPos = screenToFlowPositionRef.current({ x: clientX, y: clientY });

      skipNextPaneClickRef.current = true;

      setContextMenu({
        type: "connection",
        screenX: clientX,
        screenY: clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
        fromNodeId: connectionState.fromNode.id,
        fromHandleId: connectionState.fromHandle?.id ?? null,
        fromHandleType: (connectionState.fromHandle?.type as "source" | "target") ?? "source",
      });
    },
    [],
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  const updateSelectedNode = (patch: Partial<FlowNodeData>) => {
    if (!selectedNodeId) return;
    const nextNodes = nodes.map((node) => {
      if (node.id !== selectedNodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...patch,
        },
      };
    });
    setNodes(nextNodes);
    updateNodeInternals(selectedNodeId);
    persistCurrent(nextNodes, edges);
  };

  const deleteNodeById = (nodeId: string) => {
    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    const nextEdges = edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setNodes(nextNodes);
    setEdges(nextEdges);
    persistCurrent(nextNodes, nextEdges);
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    deleteNodeById(selectedNodeId);
  };

  const createBlueprint = () => {
    const next = [
      ...blueprints,
      createStarterBlueprint(`Blueprint ${blueprints.length + 1}`),
    ];
    setBlueprints(next);
    setSelectedBlueprintId(next[next.length - 1]?.id ?? "");
    saveBlueprints(next);
  };

  const deleteBlueprint = (id: string) => {
    if (blueprints.length === 1) return;
    const next = blueprints.filter((blueprint) => blueprint.id !== id);
    setBlueprints(next);
    if (selectedBlueprintId === id) {
      setSelectedBlueprintId(next[0]?.id ?? "");
    }
    saveBlueprints(next);
  };

  const renameBlueprint = (name: string) => {
    if (!selectedBlueprint) return;
    const next = blueprints.map((blueprint) =>
      blueprint.id === selectedBlueprint.id
        ? {
            ...blueprint,
            name,
          }
        : blueprint,
    );
    setBlueprints(next);
    saveBlueprints(next);
  };

  const nodeTypes = useMemo(
    () => ({
      inputNode: InputNode,
      outputNode: OutputNode,
      decisionNode: DecisionNode,
      phantom: PhantomNode,
    }),
    [],
  );

  // Inject a phantom node + temporary edge while the connection picker is open
  const { phantomNodes, phantomEdges } = useMemo(() => {
    if (!contextMenu || contextMenu.type !== "connection") {
      return { phantomNodes: [] as Node<FlowNodeData>[], phantomEdges: [] as Edge[] };
    }
    const phantomNode: Node<FlowNodeData> = {
      id: PHANTOM_NODE_ID,
      type: "phantom",
      position: { x: contextMenu.flowX, y: contextMenu.flowY },
      data: { label: "", inputs: [], outputs: [] },
      style: { width: 1, height: 1, opacity: 0, pointerEvents: "none" },
    };
    const phantomEdge: Edge =
      contextMenu.fromHandleType === "source"
        ? {
            id: PHANTOM_EDGE_ID,
            source: contextMenu.fromNodeId,
            target: PHANTOM_NODE_ID,
            sourceHandle: contextMenu.fromHandleId,
            type: "smoothstep",
            animated: true,
            style: { strokeDasharray: "6 3", opacity: 0.4 },
          }
        : {
            id: PHANTOM_EDGE_ID,
            source: PHANTOM_NODE_ID,
            target: contextMenu.fromNodeId,
            targetHandle: contextMenu.fromHandleId,
            type: "smoothstep",
            animated: true,
            style: { strokeDasharray: "6 3", opacity: 0.4 },
          };
    return { phantomNodes: [phantomNode], phantomEdges: [phantomEdge] };
  }, [contextMenu]);

  return (
    <div className="relative flex min-h-screen bg-[#0d0f0f] text-[#c8ccc9]">
      <div className="ambient-glow" />
      <aside className="relative z-10 w-[300px] border-r border-white/10 bg-[#0d0f0f]/95 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#5c635e]">
              Blueprints
            </p>
            <h1 className="text-lg font-semibold text-[#e0e5e2]">
              Blueprint Studio
            </h1>
          </div>
          <Button size="sm" variant="outline" onClick={createBlueprint}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        <div className="space-y-2">
          {blueprints.map((blueprint) => {
            const selected = blueprint.id === selectedBlueprintId;
            return (
              <button
                key={blueprint.id}
                onClick={() => setSelectedBlueprintId(blueprint.id)}
                className={`flex w-full items-center justify-between border px-3 py-2 text-left text-sm transition ${
                  selected
                    ? "border-[#5a7a6a] bg-[#1a1f1d] text-[#e0e5e2]"
                    : "border-white/10 bg-[#161a19] text-[#8a918c] hover:border-white/20"
                }`}
              >
                <span>{blueprint.name}</span>
                <span
                  className="text-[#5c635e] hover:text-[#c45c5c]"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteBlueprint(blueprint.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </span>
              </button>
            );
          })}
        </div>

        {selectedBlueprint ? (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="mb-1 text-xs uppercase tracking-[0.18em] text-[#5c635e]">
              Selected Blueprint
            </p>
            <Input
              value={selectedBlueprint.name}
              onChange={(event) => renameBlueprint(event.target.value)}
            />
            <div className="mt-3 flex items-center gap-2 text-xs">
              {status === "saved" ? (
                <>
                  <CheckCircle2 className="size-4 text-[#5a7a6a]" />
                  <span className="text-[#8a918c]">Validated and saved</span>
                </>
              ) : (
                <>
                  <AlertCircle className="size-4 text-[#c45c5c]" />
                  <span className="text-[#c45c5c]">
                    Invalid changes (not persisted)
                  </span>
                </>
              )}
            </div>
            <Button
              className="mt-3 w-full"
              variant="default"
              disabled={status !== "saved" || dispatching}
              onClick={dispatchBlueprint}
            >
              {dispatching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {dispatching ? "Dispatching..." : "Dispatch"}
            </Button>
          </div>
        ) : null}

        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[#5c635e]">
            Node Palette
          </p>
          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="secondary"
              onClick={() => addNodeByType("inputNode")}
            >
              Add Input
            </Button>
            <Button
              variant="secondary"
              onClick={() => addNodeByType("outputNode")}
            >
              Add Output
            </Button>
            <Button
              variant="secondary"
              onClick={() => addNodeByType("decisionNode")}
            >
              Add Decision
            </Button>
            <Button
              variant="outline"
              onClick={() => fitView({ duration: 260, padding: 0.24 })}
            >
              Recenter Graph
            </Button>
          </div>
        </div>

      </aside>

      <main className="relative z-10 flex min-h-screen flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={[...displayNodes, ...phantomNodes as Node<FlowNodeData, FlowNodeType>[]]}
            edges={[...edges, ...phantomEdges]}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            connectionLineType={ConnectionLineType.Step}
            connectionLineStyle={{ strokeDasharray: "6 3", opacity: 0.4, animation: "dashdraw 0.5s linear infinite" }}
            connectionRadius={80}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_event, node) => {
              setSelectedNodeId(node.id);
              setContextMenu(null);
            }}
            onPaneClick={() => {
              if (skipNextPaneClickRef.current) {
                skipNextPaneClickRef.current = false;
                return;
              }
              setSelectedNodeId(null);
              setContextMenu(null);
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setContextMenu({
                type: "pane",
                screenX: event.clientX,
                screenY: event.clientY,
                flowX: flowPos.x,
                flowY: flowPos.y,
              });
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setContextMenu({
                type: "node",
                screenX: event.clientX,
                screenY: event.clientY,
                nodeId: node.id,
              });
            }}
            onMoveStart={() => {
              if (skipNextPaneClickRef.current) {
                skipNextPaneClickRef.current = false;
                return;
              }
              // Keep connection picker open during pan — it tracks the viewport
              setContextMenu((cur) =>
                cur?.type === "connection" ? cur : null,
              );
            }}
            panOnScroll
            zoomOnScroll={false}
            fitView
          >
            <Background color="rgba(255,255,255,0.06)" gap={22} />
            <Controls />
          </ReactFlow>
          {selectedNode && (
            <FloatingNodeToolbar
              node={selectedNode}
              errors={validationErrors}
              onUpdate={updateSelectedNode}
              onDelete={deleteSelectedNode}
            />
          )}
          {contextMenu && contextMenu.type === "connection" ? (
            <ConnectionNodePicker
              menu={contextMenu}
              onAddNode={addNodeByType}
              onClose={() => setContextMenu(null)}
            />
          ) : contextMenu ? (
            <CanvasContextMenu
              menu={contextMenu}
              onAddNode={addNodeByType}
              onDeleteNode={deleteNodeById}
              onClose={() => setContextMenu(null)}
            />
          ) : null}
        </div>
      </main>

      {activeRedprint && (
        <aside className="relative z-10 w-[300px] border-l border-white/10 bg-[#0d0f0f]/95 p-4 overflow-y-auto">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.18em] text-[#5c635e]">
              Redprint
            </p>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                activeRedprint.status === "running"
                  ? "bg-[#5a7a6a]/20 text-[#5a7a6a]"
                  : activeRedprint.status === "completed"
                    ? "bg-[#437c6e]/20 text-[#437c6e]"
                    : "bg-[#c45c5c]/20 text-[#c45c5c]"
              }`}
            >
              {activeRedprint.status}
            </span>
          </div>

          <p className="mb-3 text-sm text-[#e0e5e2]">{activeRedprint.name}</p>

          <div className="space-y-2">
            {activeRedprint.nodes.map((node) => (
              <div
                key={node.name}
                className="flex items-center justify-between border border-white/10 bg-[#161a19] px-3 py-2"
              >
                <div>
                  <p className="text-xs text-[#e0e5e2]">{node.label ?? node.name}</p>
                  <p className="text-[10px] text-[#5c635e]">
                    {node.role} &middot; {node.status}
                  </p>
                  {node.firedAt && (
                    <p className="text-[10px] text-[#8a918c]">
                      {new Date(node.firedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
                {node.role === "producer" &&
                  activeRedprint.status === "running" && (
                    <button
                      className="rounded border border-white/10 px-2 py-1 text-[10px] text-[#5a7a6a] hover:bg-white/5"
                      onClick={() => pushEvent(node.name)}
                    >
                      <Zap className="inline size-3" /> Push
                    </button>
                  )}
              </div>
            ))}
          </div>

          {activeRedprint.decision && (
            <div className="mt-3 border border-[#437c6e]/30 bg-[#437c6e]/10 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-[#437c6e]">
                Decision Result
              </p>
              <p className="text-sm font-semibold text-[#e0e5e2]">
                {activeRedprint.decision.verb} on{" "}
                {activeRedprint.decision.market_id}
              </p>
            </div>
          )}

          <Button
            className="mt-4 w-full"
            variant="outline"
            onClick={teardownRedprint}
          >
            <Square className="size-4" />
            Teardown
          </Button>
        </aside>
      )}
    </div>
  );
}

export function BlueprintStudio() {
  return (
    <ReactFlowProvider>
      <BlueprintStudioInner />
    </ReactFlowProvider>
  );
}
