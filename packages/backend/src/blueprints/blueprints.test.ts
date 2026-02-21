import { describe, expect, it } from "vitest";
import { BlueprintBuilder, BlueprintUtils, type Blueprint } from "./index";

function validBlueprint(): Blueprint {
  return new BlueprintBuilder("Valid graph")
    .addNode({
      id: "input-1",
      type: "input",
      label: "Input",
      position: { x: 0, y: 0 },
      outputs: ["topic.orders"],
      inputs: [],
    })
    .addNode({
      id: "output-1",
      type: "output",
      label: "Consumer",
      position: { x: 300, y: 0 },
      outputs: [],
      inputs: ["topic.orders"],
    })
    .addNode({
      id: "decision-1",
      type: "decision",
      label: "End Decision",
      position: { x: 600, y: 0 },
      outputs: ["approved", "rejected"],
      inputs: ["topic.orders"],
      action: { verb: "buy", market_id: "TEST-MARKET" },
    })
    .addEdge({ id: "edge-1", source: "input-1", target: "output-1" })
    .addEdge({ id: "edge-2", source: "output-1", target: "decision-1" })
    .build();
}

describe("BlueprintBuilder", () => {
  it("builds a blueprint from fluent node/edge operations", () => {
    const blueprint = new BlueprintBuilder("My Blueprint")
      .addNode({
        id: "input-1",
        type: "input",
        label: "Input",
        position: { x: 50, y: 50 },
        outputs: ["topic.alpha"],
        inputs: [],
      })
      .addNode({
        id: "decision-1",
        type: "decision",
        label: "Decision",
        position: { x: 300, y: 50 },
        outputs: ["yes", "no", "maybe"],
        inputs: ["topic.alpha"],
      })
      .addEdge({ id: "edge-1", source: "input-1", target: "decision-1" })
      .build();

    expect(blueprint.name).toBe("My Blueprint");
    expect(blueprint.nodes).toHaveLength(2);
    expect(blueprint.edges).toHaveLength(1);
  });
});

describe("BlueprintUtils.validate", () => {
  it("returns valid true for a blueprint that satisfies all constraints", () => {
    const result = BlueprintUtils.validate(validBlueprint());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags topics with no consumers", () => {
    const blueprint = new BlueprintBuilder("No consumer")
      .addNode({
        id: "input-1",
        type: "input",
        label: "Input",
        position: { x: 0, y: 0 },
        outputs: ["topic.orphan"],
        inputs: [],
      })
      .addNode({
        id: "decision-1",
        type: "decision",
        label: "End",
        position: { x: 300, y: 0 },
        outputs: ["branch-a"],
        inputs: [],
      })
      .addEdge({ id: "edge-1", source: "input-1", target: "decision-1" })
      .build();

    const result = BlueprintUtils.validate(blueprint);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.code === "TOPIC_WITHOUT_CONSUMER"),
    ).toBe(true);
  });

  it("flags invalid node references in edges", () => {
    const baseline = validBlueprint();
    const blueprint = {
      ...baseline,
      edges: [
        ...baseline.edges,
        { id: "edge-invalid", source: "missing-node", target: "output-1" },
      ],
    };

    const result = BlueprintUtils.validate(blueprint);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.code === "INVALID_NODE_REFERENCE"),
    ).toBe(true);
  });

  it("flags cyclic graphs", () => {
    const baseline = validBlueprint();
    const blueprint = {
      ...baseline,
      edges: [
        ...baseline.edges,
        { id: "edge-cycle", source: "decision-1", target: "input-1" },
      ],
    };

    const result = BlueprintUtils.validate(blueprint);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "CYCLE_DETECTED")).toBe(
      true,
    );
  });

  it("requires a terminal decision node", () => {
    const baseline = validBlueprint();
    const blueprint = {
      ...baseline,
      edges: baseline.edges.filter((edge) => edge.target !== "decision-1"),
      nodes: baseline.nodes.filter((node) => node.type !== "decision"),
    };

    const result = BlueprintUtils.validate(blueprint);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.code === "MISSING_TERMINAL_DECISION"),
    ).toBe(true);
  });
});
