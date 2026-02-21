"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  Background,
  Controls,
  type Connection,
  type EdgeChange,
  type Edge,
  Handle,
  type NodeChange,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import {
  BlueprintBuilder,
  BlueprintUtils,
  type Blueprint,
} from "@repo/backend/blueprints";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Plus,
  Trash2,
} from "lucide-react";

import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const STORAGE_KEY = "blueprints:v1";

type FlowNodeType = "inputNode" | "outputNode" | "decisionNode";

type FlowNodeData = {
  label: string;
  inputs: string[];
  outputs: string[];
};

type BlueprintError = ReturnType<
  typeof BlueprintUtils.validate
>["errors"][number];

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
      id: "output-1",
      type: "output",
      label: "Output",
      position: { x: 440, y: 240 },
      inputs: ["topic.orders"],
      outputs: [],
    })
    .addNode({
      id: "decision-1",
      type: "decision",
      label: "Terminal Decision",
      position: { x: 780, y: 240 },
      inputs: ["topic.orders"],
      outputs: ["approved", "rejected"],
    })
    .addEdge({ id: "edge-1", source: "input-1", target: "output-1" })
    .addEdge({ id: "edge-2", source: "output-1", target: "decision-1" })
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
  children,
}: {
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[200px] border border-white/10 bg-[#161a19] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
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
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <p className="text-[11px] text-[#8a918c]">
        Consumes: {data.inputs.join(", ") || "none"}
      </p>
      <p className="text-[11px] text-[#8a918c]">
        Publishes: {data.outputs.join(", ") || "none"}
      </p>
      <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
        Target / Source
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
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-[11px] text-[#8a918c]">
        Consumes: {data.inputs.join(", ") || "none"}
      </p>
      <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
        Branches
      </div>
      <div className="mt-1 space-y-1">
        {data.outputs.map((branch, index) => (
          <div
            key={branch}
            className="relative rounded border border-white/10 px-2 py-1 text-[11px] text-[#c8ccc9]"
          >
            {branch}
            <Handle
              id={branch}
              type="source"
              position={Position.Right}
              style={{ top: 20 + index * 34 }}
            />
          </div>
        ))}
      </div>
    </BaseNode>
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
  const updateNodeInternals = useUpdateNodeInternals();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const selectedBlueprint = useMemo(
    () => blueprints.find((item) => item.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId],
  );

  useEffect(() => {
    const loaded = loadBlueprints();
    setBlueprints(loaded);
    setSelectedBlueprintId(loaded[0]?.id ?? "");
  }, []);

  useEffect(() => {
    if (!selectedBlueprint) return;
    const flow = blueprintToFlow(selectedBlueprint);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    const result = BlueprintUtils.validate(selectedBlueprint);
    setValidationErrors(result.errors);
    setStatus(result.valid ? "saved" : "invalid");
  }, [selectedBlueprint]);

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

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData, FlowNodeType>>[]) => {
      const next = applyNodeChanges(changes, nodes);
      setNodes(next);
      persistCurrent(next, edges);
    },
    [edges, nodes, persistCurrent],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const next = applyEdgeChanges(changes, edges);
      setEdges(next);
      persistCurrent(nodes, next);
    },
    [edges, nodes, persistCurrent],
  );

  const addNodeByType = (type: FlowNodeType) => {
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

    const id = `${type}-${Date.now()}`;
    const anchor = nodes[nodes.length - 1];
    const node: Node<FlowNodeData, FlowNodeType> = {
      id,
      type,
      position: anchor
        ? { x: anchor.position.x + 260, y: anchor.position.y + 24 }
        : { x: center.x, y: center.y },
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
    setSelectedNodeId(id);
    persistCurrent(nextNodes, edges);
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

      const sourceNode = nodes.find((node) => node.id === connection.source);
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
        edges,
      );
      setEdges(nextEdges);
      persistCurrent(nodes, nextEdges);
    },
    [edges, nodes, persistCurrent],
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

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    const nextNodes = nodes.filter((node) => node.id !== selectedNodeId);
    const nextEdges = edges.filter(
      (edge) =>
        edge.source !== selectedNodeId && edge.target !== selectedNodeId,
    );
    setSelectedNodeId(null);
    setNodes(nextNodes);
    setEdges(nextEdges);
    persistCurrent(nextNodes, nextEdges);
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
    }),
    [],
  );

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
        <div className="flex-1 border-r border-white/10">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            onConnect={onConnect}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            fitView
          >
            <Background color="rgba(255,255,255,0.06)" gap={22} />
            <Controls />
          </ReactFlow>
        </div>

        <section className="w-[360px] overflow-y-auto bg-[#0d0f0f] p-4">
          <Card className="border-white/10 bg-[#161a19] py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm text-[#e0e5e2]">
                Node Inspector
              </CardTitle>
              <CardDescription className="text-[#8a918c]">
                Select a node to edit label, topics, and decision branches.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {selectedNode ? (
                <>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#5c635e]">
                      Label
                    </p>
                    <Input
                      value={selectedNode.data.label}
                      onChange={(event) =>
                        updateSelectedNode({ label: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#5c635e]">
                      Inputs (comma separated)
                    </p>
                    <Input
                      value={selectedNode.data.inputs.join(", ")}
                      onChange={(event) =>
                        updateSelectedNode({
                          inputs: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#5c635e]">
                      Outputs (comma separated)
                    </p>
                    <Input
                      value={selectedNode.data.outputs.join(", ")}
                      onChange={(event) =>
                        updateSelectedNode({
                          outputs: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="destructive"
                    onClick={deleteSelectedNode}
                    className="w-full"
                  >
                    Delete Node
                  </Button>
                </>
              ) : (
                <p className="text-sm text-[#8a918c]">No node selected.</p>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4 border-white/10 bg-[#161a19] py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm text-[#e0e5e2]">
                Validation
              </CardTitle>
              <CardDescription className="text-[#8a918c]">
                Frontend guardrails using `BlueprintUtils.validate()`.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              {validationErrors.length === 0 ? (
                <p className="text-sm text-[#8a918c]">All checks passing.</p>
              ) : (
                validationErrors.map((error) => (
                  <div
                    key={`${error.code}-${error.edgeId ?? ""}-${error.nodeId ?? ""}`}
                    className="border border-[#8b4449]/60 p-2 text-xs text-[#e0e5e2]"
                  >
                    <p className="font-semibold text-[#c45c5c]">{error.code}</p>
                    <p className="text-[#c8ccc9]">{error.message}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </main>
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
